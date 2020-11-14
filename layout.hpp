#include "quadTree.hpp"
#include <emscripten/bind.h>
#include <algorithm>
#include <time.h>
#include <thread>
#include <mutex>
#include <atomic>

#ifndef LAYOUT
#define LAYOUT

template <class T>
class ThreadRunner{
public:
    std::thread* worker;
    std::mutex run{}, done{};
    T* runnerObj;
    std::atomic_bool running;
    long startPos;
    long endPos;

    ThreadRunner(T* runnerObj){
        this->runnerObj = runnerObj;
        run.lock();
        worker = new std::thread(&ThreadRunner::loopFunc, this);
        running = true;
    }

//Unlocks run, letting the loopFunc
//acquire it and start running
//Also locks done, so that calls to
//wait will block until the loopFunc
//unlocks done
    void start(long startPos, long endPos){
        done.lock();
        this->startPos = startPos;
        this->endPos = endPos;
        run.unlock();
    }

//Blocks until done becomes unlocked,
//then unlocks done. Used to wait for
//loopfunc to complete
    void wait(){
        done.lock();
        done.unlock();
    }
private:
//Every time this acquires a lock on run, it runs
//The lock on run it acquires must be free using a call
//to "wait", before a new piece of work can be added using
//"start"
    void loopFunc(){
        while(running){
            run.lock();
            runnerObj->run(startPos, endPos);
            done.unlock();
        }
    }

    ~ThreadRunner(){
        running = false;
        run.unlock();//Ensure the worker can exit
        worker->join();
        delete worker;
    }
};

class Layout{
    std::unordered_map<std::string, Body*> bodies{};
    std::unordered_map<std::string, Spring*> springs{};

    std::pair<Vector2D, Vector2D> bb {{}, {}};

//List of body id's kept in sync with 
//js side list to allow for high performance
//return from step
    std::vector<std::string> bodyList{};

    Node* root = nullptr;

    QuadTree qt;

//Physics constants
    float gravity = -1.0;
    float theta = 0.8;
    float dragCoeff = 0.02;
    float timestep = 20;

    float* xResVals = nullptr;
    float* yResVals = nullptr;

    std::vector<ThreadRunner<Layout>*> workers;
    bool isFirstStep = true;
public:
//Constructor - takes a vector of bodies initialized on the
//js side
    Layout(std::vector<Body> initBodies,
           std::vector<Spring> initSprings,
           float gravity,
           float theta,
           float dragCoeff,
           float timestep) : qt()
    {
//These bodies are set up on the js side and then passed in
        for(auto b: initBodies){
            bodies[b.id] = new Body(b);
            bodyList.push_back(b.id);
        }
        for(auto s: initSprings){
            springs[s.id] = new Spring(s);
        }
        updateBounds();
        this->gravity = gravity;
        this->theta = theta;
        this->dragCoeff = dragCoeff;
        this->timestep = timestep;
        for(int i = 0; i < 4; i++){
            workers.push_back(new ThreadRunner<Layout>(this));
        }
    }

//Do a physics step
//Return the bodies?
    void step(){
//These are only set to null by the contructor or
//by a growing of the bodyList
        if(xResVals == nullptr){
            xResVals = (float*)malloc(bodies.size()*sizeof(float));
        }
        if(yResVals == nullptr){
            yResVals = (float*)malloc(bodies.size()*sizeof(float));
        }
//If this is the first time step is called, we need to fake a step
//and set up our worker thread to do the accumulateForces
        if(isFirstStep){
            for(long i = 0; i < bodyList.size(); i++){
                xResVals[i] = bodies[bodyList[i]]->pos.x;
                yResVals[i] = bodies[bodyList[i]]->pos.y;
            }
//Otherwise we integrate the forces the worker thread found between the
//last step call and this one, and fill the res arrays with those forces,
//and delete the old worker thread
        } else {
//Wait for the workers to finish calculating body forces
            for(int i = 0; i < workers.size(); i++){
                workers[i]->wait();
            }
//calculate the spring forces (O[N])
            for(auto p: springs){
                auto id = std::get<0>(p);
                auto spring = std::get<1>(p);
                updateSpringForce(spring);
            }
//Set the new body positions (O[N]
            integrateForces(xResVals, yResVals);
        }
        qt.insertBodies(bodies);
        root = qt.getRoot();
        long chunkLen = bodyList.size() / workers.size();
        for(int i = 0; i < workers.size(); i++){
            workers[i]->start(
                i*chunkLen,
                i+1 == workers.size() ? bodyList.size() : (i+1)*chunkLen
            );
        }
        isFirstStep = false;
    }

//This is /filthy/ but embind doesn't support
//pointers to raw types so here we are
    long getXResVals(){ return (long)xResVals;}
    long getYResVals(){ return (long)yResVals;}

//Returns top_left, bottom_right of graph bounding box
    std::vector<Vector2D> getGraphRect(){
        return {std::get<0>(bb), std::get<1>(bb)};
    }

//Set a nodes isPinned state
    void pinNode(std::string nodeId, bool isPinned){
        if(bodies.count(nodeId)){
            bodies[nodeId]->isPinned = isPinned;
        }
    }

//Returns the value of isPinned for the relevant node
    bool isNodePinned(std::string nodeId){
        if(bodies.count(nodeId)){
            return bodies[nodeId]->isPinned;
        }
        return false;
    }

//Frees all current used memory (basically a destructor)
    void dispose(){
        for(auto b: bodies){
            delete std::get<1>(b);
        }
        for(auto s: springs){
            delete std::get<1>(s);
        }
        bodies.clear();
        springs.clear();
    }

//Returns a body by copy, id 0 if not found
    Body getBody(std::string nodeId){
        if(bodies.count(nodeId)){
            return *(bodies[nodeId]);
        }
        return {};
    }

//Overwrites the body with given id
//creating if not already present
    void setBody(std::string id, Body b){
        if(bodies.count(id) < 1){
            bodyList.push_back(id);
//Force a re-alloc of these as the bodyList may
//now be longer than the original alloc length
            if(xResVals != nullptr){
                free(xResVals);
                xResVals = nullptr;
            }
            if(yResVals != nullptr){
                free(yResVals);
                yResVals = nullptr;
            }
        }
        *(bodies[id]) = b;
        updateBounds();
    }

//Returns a spring by copy, id 0 if not found
//creating if not already present
    Spring getSpring(std::string linkId){
        if(springs.count(linkId)){
            return *(springs[linkId]);
        }
        return {};
    }

    void setSpring(std::string id, Spring s){
        *(springs[id]) = s;
    }

    void removeBody(std::string id){
        if(bodies.count(id)){
            delete bodies[id];
            bodies.erase(id);
            bodyList.erase(std::remove(bodyList.begin(), bodyList.end(), id), bodyList.end());
            updateBounds();
        }
    }

    void removeLink(std::string id){
        if(springs.count(id)){
            delete springs[id];
            springs.erase(id);
        }
    }

    void updateBounds(){
        float x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for(auto p: bodies){
            updateBounds(std::get<1>(p));
        }
    }

    void updateBounds(Body* b){
        auto x1 = &(std::get<0>(bb).x);
        auto y1 = &(std::get<0>(bb).y);
        auto x2 = &(std::get<1>(bb).x);
        auto y2 = &(std::get<1>(bb).y);
        if(b->pos.x < *x1) *x1 = b->pos.x;
        if(b->pos.y < *y1) *y1 = b->pos.y;
        if(b->pos.x > *x2) *x2 = b->pos.x;
        if(b->pos.y > *y2) *y2 = b->pos.y;
    }

//At this point root is valid
//reset body->force values,
//calculate the gravity + drag
//forces, then find the spring forces
    void accumulateBodyForces(long startPos, long endPos){
        std::vector<Node*> updateQueue{};
        updateQueue.reserve(1024);
        for(long i = startPos; i < endPos; i++){
            auto b = bodies[bodyList[i]];
            b->force = {0, 0};
            updateBodyForce(b, root, updateQueue);
            updateDragForce(b);
        }
    }

//At this point all b->force values are valid
//Use this information to calculate the new
//b->velocity and b->pos values
    void integrateForces(float* xResVals, float* yResVals){
        float dx = 0, dy = 0;
        long i = 0;
        for(long i = 0; i < bodyList.size(); i++){
            auto id = bodyList[i];
            auto body = bodies[id];
            float coeff = timestep / body->mass;
            body->velocity.x += coeff * body->force.x;
            body->velocity.y += coeff * body->force.y;
            float vx = body->velocity.x;
            float vy = body->velocity.y;
            float v = std::sqrt(vx * vx + vy * vy);
            if(v > 1.0){
                body->velocity = {vx / v, vy / v};
            }
            body->pos.x += body->velocity.x * timestep;
            body->pos.y += body->velocity.y * timestep;
            xResVals[i] = body->pos.x;
            yResVals[i] = body->pos.y;
            updateBounds(body);
        }
    }

    void updateBodyForce(Body* sourceBody, Node* root, std::vector<Node*> &updateQueue){
        updateQueue.clear();
        float v, dx, dy, r, fx=0, fy=0;
        updateQueue.push_back(root);
        while(updateQueue.size() > 0){
            auto node = updateQueue[updateQueue.size()-1];
            updateQueue.pop_back();
            auto body = node->body;
            auto differentBody = body != sourceBody;
            if(body != nullptr && differentBody){
                dx = body->pos.x - sourceBody->pos.x;
                dy = body->pos.y - sourceBody->pos.y;
                r = std::sqrt(dx*dx + dy*dy) + 0.000000001;//Avoiding div by 0
                v = gravity * body->mass * sourceBody->mass / (r * r * r);
                fx += v * dx;
                fy += v * dy;
            } else if(differentBody){
                dx = (node->massX / node->mass) - sourceBody->pos.x;
                dy = (node->massY / node->mass) - sourceBody->pos.y;
                r = std::sqrt(dx*dx + dy*dy) + 0.000000001;//Avoiding div by 0
                if((node->right - node->left) / r < theta){
                    v = (gravity * node->mass * sourceBody->mass) / (r * r * r);
                    fx += v * dx;
                    fy += v * dy;
                } else {
                    if (node->q0 != nullptr) {
                        updateQueue.push_back(node->q0);
                    }
                    if (node->q1 != nullptr) {
                        updateQueue.push_back(node->q1);
                    }
                    if (node->q2 != nullptr) {
                        updateQueue.push_back(node->q2);
                    }
                    if (node->q3 != nullptr) {
                        updateQueue.push_back(node->q3);
                    }
                }
            }
        }
        sourceBody->force.x += fx;
        sourceBody->force.y += fy;
    }

    void updateDragForce(Body* body){
        body->force.x -= dragCoeff * body->velocity.x;
        body->force.y -= dragCoeff * body->velocity.y;
    }

    void updateSpringForce(Spring* spring){
//Little bit of safety
        if(bodies.count(spring->from) < 1 || bodies.count(spring->to) < 1){
            removeLink(spring->id);
            return;
        }
        auto body1 = bodies[spring->from];
        auto body2 = bodies[spring->to];
        auto length = spring->length;
        auto dx = body2->pos.x - body1->pos.x;
        auto dy = body2->pos.y - body1->pos.y;
        auto r = std::sqrt(dx*dx + dy*dy) + 0.000000001;
        auto d = r - length;
        auto coeff = (spring->coeff * d) / (r * spring->weight);

        body1->force.x += coeff * dx;
        body1->force.y += coeff * dy;
        body2->force.x -= coeff * dx;
        body2->force.y -= coeff * dy;
    }


//Utility functions
    static std::vector<Body> getUninitializedBodies(long count){
        std::vector<Body> res{};
        res.reserve(count);
        for(long i = 0; i < count; i++){
            res.push_back(Body{});
        }
        return res;
    }

    static std::vector<Spring> getUninitializedSprings(long count){
        std::vector<Spring> res{};
        res.reserve(count);
        for(long i = 0; i < count; i++){
            res.push_back(Spring{});
        }
        return res;
    }

//Used for ThreadRunner class
    void run(long startPos, long endPos){
        this->accumulateBodyForces(startPos, endPos);
    }
};

EMSCRIPTEN_BINDINGS(Layout){
    emscripten::class_<Layout>("WASMLayout")
    .constructor<std::vector<Body>,
        std::vector<Spring>,
        float, float, float, float>()
    .function("step", &Layout::step)
    .function("getGraphRect", &Layout::getGraphRect)
    .function("pinNode", &Layout::pinNode)
    .function("isNodePinned", &Layout::isNodePinned)
    .function("dispose", &Layout::dispose)
    .function("getBody", &Layout::getBody)
    .function("setBody", &Layout::setBody)
    .function("getSpring", &Layout::getSpring)
    .function("setSpring", &Layout::setSpring)
    .function("removeBody", &Layout::removeBody)
    .function("removeLink", &Layout::removeLink)
    .function("getXResVals", &Layout::getXResVals)
    .function("getYResVals", &Layout::getYResVals)
    .class_function("getUninitializedSprings", &Layout::getUninitializedSprings)
    .class_function("getUninitializedBodies", &Layout::getUninitializedBodies);
    emscripten::register_vector<Body>("vector<Body>");
    emscripten::register_vector<Vector2D>("vector<Vector2D>");
    emscripten::register_vector<Spring>("vector<Spring>");
}

#endif