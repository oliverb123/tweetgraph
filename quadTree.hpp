#include "primitives.hpp"
#include <unordered_map>
#include <random>
#include <emscripten/bind.h>

#ifndef QUADTREE
#define QUADTREE
class QuadTree{

    InsertStack<std::pair<Node*, Body*>> stack{};

    Node* root = nullptr;

    std::uniform_real_distribution<float> randomDist{0,1};
    std::default_random_engine re;

    float random(){
        return randomDist(re);
    }

    std::vector<Node*> nodeCache{};

    Node* getNode(){
        Node* res;
        if(nodeCache.size() < 1){
            res = new Node();
        } else {
            res = nodeCache[nodeCache.size()-1];
            nodeCache.pop_back();
            res->reset();
        }
        return res;
    }

//Adds a node and all it's sub-nodes to the node cache
    void cacheNodes(Node* n){
        n->cache(nodeCache);
    }

public:
    Node* getRoot(){ return root; }

    QuadTree(){
//We prealloc and cache a shit tonne of nodes
        for(int i = 0; i < 1024; i++){
            Node* n = new Node();
            n->cache(nodeCache);
        }
    }

    void insertBodies(std::unordered_map<std::string, Body*> bodies){
        if(root != nullptr){//Clean up from the last iteration. TODO - offload deletion to a different thread
            cacheNodes(root);
            root = nullptr;
        }
        float x1 = 0;
        float y1 = 0;
        float x2 = 0;
        float y2 = 0;
        int max = bodies.size();
//Find out initial bounding box
        for(auto p: bodies){
            float x = std::get<1>(p)->pos.x;
            float y = std::get<1>(p)->pos.y;
            if (x < x1) {
                x1 = x;
            }
            if (x > x2) {
                x2 = x;
            }
            if (y < y1) {
                y1 = y;
            }
            if (y > y2) {
                y2 = y;
            }
        }
        float dx = x2 - x1;
        float dy = y2 - y1;
        if(dx > dy){
            y2 = y1+dx;
        } else {
            x2 = x1 + dy;
        }
        root = this->getNode();
        root->left = x1;
        root->right = x2;
        root->top = y1;
        root->bottom = y2;
        if(bodies.size() >= 0){
            root->body = std::get<1>(*(bodies.begin()));
        }
        for(auto p: bodies){
            insert(std::get<1>(p), root);
        }
    }

    void insert(Body* newBody, Node* root){
        stack.reset();
        stack.push({root, newBody});
        while(!stack.isEmpty()){
            auto stackItem = stack.pop();
            Node* node = std::get<0>(stackItem);
            Body* body = std::get<1>(stackItem);
            if(node->body == nullptr){
                float x = body->pos.x;
                float y = body->pos.y;
                node->mass += body->mass;
                node->massX += body->mass * x;
                node->massY += body->mass * y;
                int quadIdx = 0;
                float left = node->left;
                float right = (node->right + left)/2.0;
                float top = node->top;
                float bottom = (node->bottom + top)/2.0;
                if(x > right){
                    quadIdx += 1;
                    left = right;
                    right = node->right;
                }
                if(y > bottom){
                    quadIdx += 2;
                    top = bottom;
                    bottom = node->bottom;
                }
                Node* child = node->getChild(quadIdx);
                if(child == nullptr){
                    child = this->getNode();
                    child->left = left;
                    child-> right = right;
                    child->top = top;
                    child->bottom = bottom;
                    child->body = body;
                    node->setChild(quadIdx, child);
                } else {
                    stack.push({child, body});
                }
            } else {
                Body* oldBody = node->body;
                node->body = nullptr;
                int retries = 3;
                if(oldBody == body){
                    return;
                }
                while(retries > 0 && isSamePosition(oldBody->pos, body->pos)){
                    retries--;
                    float dx = (node->right - node->left) * random();
                    float dy = (node->bottom - node->top) * random();
                    oldBody->pos.x = node->left + dx;
                    oldBody->pos.y = node->top + dy;
                }
                if(isSamePosition(oldBody->pos, body->pos)){
                    return;
                }
                stack.push({node, oldBody});
                stack.push({node, body});
            }
        }
    }

    ~QuadTree(){
        if(root != nullptr){
            delete root;
        }
    }
};

#endif