#include <cmath>
#include <vector>
#include <emscripten/emscripten.h>
#include <emscripten/bind.h>

#ifndef PRIMITIVES
#define PRIMITIVES

struct Vector2D{
    float x = 0;
    float y = 0;
};

struct Body{
    Vector2D pos = {};
    Vector2D force = {};
    Vector2D velocity = {};
    int isPinned = 0;
    std::string id = {};//0 id for invalid structure
    float mass = 0;

    Body(){}

    Body(const Body& o){
        pos = o.pos;
        force = o.force;
        velocity = o.velocity;
        isPinned = o.isPinned;
        id = o.id;
        mass = o.mass;
    }
};

struct Spring{
    std::string from = {};
    std::string to = {};
    std::string id = {};
    float weight = 0;
    float length = 0;
    float coeff = 0;

    Spring(){}

    Spring(const Spring& o){
        from = o.from;
        to = o.to;
        id = o.id;
        weight = o.weight;
        length = o.length;
        coeff = o.coeff;
    }
};

//This should be a struct but isn't for embind
class Node{
public:
    Node(){
    }
//get by copy js accessible, not settable
    Body* body = nullptr;
    Node* q0 = nullptr;
    Node* q1 = nullptr;
    Node* q2 = nullptr;
    Node* q3 = nullptr;
//js accessible
    float mass = 0;
    float massX = 0;
    float massY = 0;
    float left = 0;
    float right = 0;
    float top = 0;
    float bottom = 0;

//API necessary for embind to work
    Body getBody() const {return (body == nullptr ? Body{} : *body);}

//Deleting a node should delete all sub nodes
//DANGER: Loops in node structure
    ~Node(){
        if(q0 != nullptr) delete q0;
        if(q1 != nullptr) delete q1;
        if(q2 != nullptr) delete q2;
        if(q3 != nullptr) delete q3;
    }

    Node* getChild(int idx){
        if (idx == 0) return q0;
        if (idx == 1) return q1;
        if (idx == 2) return q2;
        if (idx == 3) return q3;
        return nullptr;
    }

    void setChild(int idx, Node* child){
        if (idx == 0) q0 = child;
        if (idx == 1) q1 = child;
        if (idx == 2) q2 = child;
        if (idx == 3) q3 = child;
    }

    Node getChildCopy(int idx){
        return *(getChild(idx));
    }

    void cache(std::vector<Node*>& cache){
        if(q0 != nullptr) q0->cache(cache);
        if(q1 != nullptr) q1->cache(cache);
        if(q2 != nullptr) q2->cache(cache);
        if(q3 != nullptr) q3->cache(cache);
        cache.push_back(this);
    }

    void reset(){
        this->body = nullptr;
        this->q0 = nullptr;
        this->q1 = nullptr;
        this->q2 = nullptr;
        this->q3 = nullptr;
        this->mass = 0;
        this->massX = 0;
        this->massY = 0;
        this->left = 0;
        this->right = 0;
        this->top = 0;
        this->bottom = 0;
    }
};

bool isSamePosition(Vector2D p1, Vector2D p2){
    float dx = std::abs(p1.x - p2.x);
    float dy = std::abs(p1.y - p2.y);
    return dx < 1e-8 && dy < 1e-8;
}

//There is no need to expose this to js
template <class T>
class InsertStack{
    std::vector<T> stack{};
    long popIdx = 0;

public:
    InsertStack(){stack.reserve(1024);}

    bool isEmpty(){return stack.size() == 0;}

    void push(T val){
        stack.push_back(val);
    }

    T pop(){
        auto res = stack[stack.size()-1];
        stack.pop_back();
        return res;
    }

    void reset(){
        stack.clear();
    }

    long size(){return stack.size();}
};

EMSCRIPTEN_BINDINGS(primitives){

    emscripten::value_object<Vector2D>("Vector2D")
    .field("x", &Vector2D::x)
    .field("y", &Vector2D::y);

    emscripten::value_object<Body>("Body")
    .field("pos", &Body::pos)
    .field("force", &Body::force)
    .field("velocity", &Body::velocity)
    .field("isPinned", &Body::isPinned)
    .field("id", &Body::id)
    .field("mass", &Body::mass);

    emscripten::value_object<Spring>("Spring")
    .field("from", &Spring::from)
    .field("to", &Spring::to)
    .field("id", &Spring::id)
    .field("weight", &Spring::weight)
    .field("length", &Spring::length)
    .field("coeff", &Spring::coeff);

//WE probably don't *need* to export these, but
//for development it's probably useful
    emscripten::class_<Node>("QTNode")
    .constructor<>()
    .property("mass", &Node::mass)
    .property("massX", &Node::massX)
    .property("massY", &Node::massY)
    .property("left", &Node::left)
    .property("right", &Node::right)
    .property("top", &Node::top)
    .property("bottom", &Node::bottom)
    .function("getBody", &Node::getBody)
    .function("getChild", &Node::getChildCopy);

}

#endif