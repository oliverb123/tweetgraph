

class WASMLayout{
    bodies = {};
    bodyList = [];
    springs = {};
    graph = null;
    nodeMass = this.defaultNodeMass;
    
    layoutEngine = null;

    springLength = 80;
    springCoeff = 0.0015;
    springWeight = 1;

    constructor(graph, settings){
        this.graph = graph;
        this.nodeMass = settings.nodeMass || this.defaultNodeMass;
        this.springTransform = settings.springTransform || this.noop;
        this.springLength = settings.springLength || this.springLength;
        this.springCoeff = settings.springCoeff || this.springCoeff;
        this.springWeight = settings.springWeight || this.springWeight;
        graph.on('changed', e => {this.onGraphChanged(e);});
        var initBodyList = this.initBodies();
        var initSpringList = this.initLinks();
        this.layoutEngine = new Module.WASMLayout(
            initBodyList,
            initSpringList,
            settings.gravity || -1.0,
            settings.theta || 0.5,
            settings.dragCoeff || 0.02,
            10);
        console.log("layoutEngine Constructed")
    }

    forEachBody(callBack){
        Object.keys(this.bodies).forEach(id => {
//Do the callback
            callBack(this.bodies[id]);
//Sync in case of callback mutations
            this.setBody(id, this.bodies[id]);
        })
    }
//Remember to do the thing
    forEachSpring(callBack){
        Object.keys(this.springs).forEach(id => {
            let s = this.springs[id];
//Do the callback
            callBack(s);
//Sync spring AND BODIES in case of callback mutation
            this.setSpring(id, s);
            this.setBody(s.from.id, s.from);
            this.setBody(s.to.id, s.from);
        })
    }

    initBodies(){
        console.log("Node count: " + this.graph.getNodesCount());
        var retBodies = Module.WASMLayout
            .getUninitializedBodies(this.graph.getNodesCount());
        var i = 0;
        this.graph.forEachNode(node => {
            let b = retBodies.get(i);
            b.id = node.id;
            b.pos = node.position;
            b.pos = {x: (100*Math.random()) - 50, y: (100*Math.random()) - 50};
            b.force = {x: 0, y: 0};
            b.velocity = {x:(100*Math.random()) - 50, y:(100*Math.random()) - 50};
            b.isPinned = false;
            b.mass = this.nodeMass(node.id);
            retBodies.set(i, b);
            this.bodies[b.id] = b;
            this.bodyList.push(b.id);
            i++;
        });
        return retBodies;
    }

    initLinks(){
        console.log("Link count: " + this.graph.getLinksCount());
        var retSprings = Module.WASMLayout
            .getUninitializedSprings(this.graph.getLinksCount());
        var i = 0
        this.graph.forEachLink(link => {
            let s = retSprings.get(i);
            s.id = link.id;
            s.from = this.bodies[link.fromId].id;
            s.to = this.bodies[link.toId].id;
            s.length = this.springLength;
            s.coeff = s.coeff || this.springCoeff;
            s.weight = link.weight || this.springWeight;
            this.springTransform(link, s);
            retSprings.set(i, s);
            this.springs[s.id] = s;
            this.springs[s.id].from = this.bodies[s.from];
            this.springs[s.id].to = this.bodies[s.to];
            i++;
        });
        return retSprings;
    }

    step(){
        this.layoutEngine.step();
        var xResPtr = this.layoutEngine.getXResVals();
        var yResPtr = this.layoutEngine.getYResVals();
        this.bodyList.forEach( (id, i) => {
            this.bodies[id].pos.x = Module.getValue(xResPtr + (i*4), "float");
            this.bodies[id].pos.y = Module.getValue(yResPtr + (i*4), "float");
        });
        return false;
    }

    getGraphRect(){
        let positions = this.layoutEngine.getGraphRect();
        let pos1 = positions.get(0);
        let pos2 = positions.get(1);
        return {x1: pos1.x, y1:pos1.y, x2:pos2.x, y2:pos2.y};
    }

    pinNode(nodeId, isPinned){
        if(this.bodies[nodeId]){
            this.bodies[nodeId].isPinned = isPinned;
            this.setBody(nodeId, this.bodies[nodeId]);
        }
    }

    isNodePinned(node){
        return this.bodies[node.id].isPinned;
    }

    
    dispose(){}

//READ ONLY MOTHERFUCKERS
    getBody(nodeId){
        return this.bodies[nodeId];
    }
    setBody(nodeId, body){
        this.layoutEngine.setBody(nodeId, body);
    }

    getSpring(linkId){
        return this.springs[linkId];
    }
    setSpring(linkId, spring){
        this.layoutEngine.setSpring(linkId, spring);
    }

    removeBody(nodeId){
        delete this.bodies[nodeId];
        this.bodyList.splice(this.bodyList.indexOf(nodeId), 1);
        this.layoutEngine.removeBody(nodeId);
    }

    removeLink(linkId){
        delete this.springs[linkId];
        this.layoutEngine.removeLink(linkId);
    }


    getNodePosition(nodeId){
        return this.bodies[nodeId].pos;
    }

    setNodePosition(nodeId, x, y){
        this.bodies[nodeId].pos.x = x;
        this.bodies[nodeId].pos.y = y;
        this.setBody(nodeId, this.bodies[nodeId]);
    }
    
    getLinkPosition(linkId){
        return {
            from: this.springs[linkId].from.pos,
            to: this.springs[linkId].to.pos
        }
    }

    defaultNodeMass(nodeId){
        var links = this.graph.getLinks(nodeId);
        if (!links) return 1;
        return 1 + links.length / 3.0;
    }

    initBody(node){
        var b = {}
        b.id = node.id
        b.pos = {x: (1000*Math.random) - 500, y: (1000*Math.random) - 500};
        b.force = {x: 0, y: 0};
        b.velocity = {x:0, y:0};
        b.isPinned = false;
        b.mass = this.nodeMass(node.id);
        this.bodies[b.id] = b;
        this.setBody(b.id, b);
    }

    initLink(link){
        var s = {}
        s.id = link.id;
        s.from = this.bodies[link.fromId].id;
        s.to = this.bodies[link.toId].id;
        s.length = link.length || this.springLength;
        s.coeff = this.springCoeff;
        s.weight = link.weight || this.springWeight;
        this.springTransform(link, s);
        this.setSpring(s.id, s);
        s.from = this.bodies[s.from];
        s.to = this.bodies[s.to];
        this.springs[s.id] = s;
    }

    releaseNode(node){
        this.removeBody(node.id);
    }

    releaseLink(link){
        this.removeLink(link.id)
    }

    noop(){}

    onGraphChanged(changes){
        for (var i = 0; i < changes.length; ++i) {
            var change = changes[i];
            if (change.changeType === 'add') {
                if (change.node) {
                    this.initBody(change.node);
                }
                if (change.link) {
                    this.initLink(change.link);
                }
            } else if (change.changeType === 'remove') {
                if (change.node) {
                    this.releaseNode(change.node);
                }
                if (change.link) {
                    this.releaseLink(change.link);
                }
            }
        }
    }
}