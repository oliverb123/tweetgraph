//Constant colors used for rendering
//TODO - Consider a quote mode and a quote free mode
//Showing quotes in full is more visually appealing,
//but not showing them unless in a special mode seems more /useful/
//const QUOTE_COLOR = 0xAA000000;
const QUOTE_COLOR = 0xFF0000FF;
const QUOTE_COLOR_DIM = 0xFF000033;
const REPLY_COLOR = 0x0000FFFF;
const REPLY_COLOR_DIM = 0x0000FF44;
const NODE_HIGHLIGHTED_COLOR = 0x00FF00FF;
const NODE_HIGHLIGHTED_COLOR_DIM = 0x00FF0044;

//API constants
const GET_USER_URL = "https://api.twitter.com/1.1/account/verify_credentials.json";
const TWEETGRAPH_API = "https://tweetgraphapi.obrowne.eu/";

//Global handles for graph rendering
var renderGraph = undefined;
var activeRenderNodes = new Set();
var graphLayout = undefined;
var graphics = undefined;
var renderer = undefined;

const RENDER_COLORS = [
    0x2274A5,
    0xF75C03,
    0xF1C40F,
    0xD90368,
    0x00CC66,
    0x878E88,
    0x050D0F
]

//Global events used to manage, e.g. twitter integration state changing
const TWITTER_INTEGRATION_CHANGE_EVENT = "twitter_integration_change";

var TWITTER_INTEGRATION_ON = false;//Assume this is not true

//Physics constants
const baseLength = 40;
const springStrength = 0.0015;
const drag = 0.02;
const repulsion = 7.0;

//Global edge sets by type
//Undirected mapping of an id to all
//the other ids it shares an edge with
var globalReplies = {};
var globalQuotes = {};

//Set of all loaded tweets by id
var loadedTweets = {};

//maps a given trig-graph to a set of
//node id's matching that trigraph
var trigGraphMap = {}

//A map of all the rules used to filter
//which nodes are marked for "active"
//rendering vs. which are marked for
//passive (dim) rendering. Every time
//refreshActiveRender is called it loops
//through this map, adding nodes for which
//all callbacks eval to true to the
//activeRenderNodes set
var filterRules = {}

function sigmoid(x){
    return 1 / (1 + Math.exp(-x));
}

class TweetWrapper {
    constructor(tweet, foreign, color, archiveName){
        this.tweet = tweet;
        this.replyId = this.tweet.reply_tweet_id;
        this.quotes = new Set();//Tweets this tweet quotes
        this.foreign = foreign;//This tweet didn't come from a users archive
//Stores this tweets color. Black if only using a single archive, some color matching to a file name otherwise
        this.color = (color << 8) + 0xFF;
        this.dim_color = (color << 8) + 0x77;
        this.highlighted = true;
        this.tweet.quoting.forEach((qt) => {
            this.quotes.add(qt.id);
        });
        this.archiveName = archiveName;
        getTriGraphs(this.tweet.text).forEach(tri => {
            if(!trigGraphMap[tri]){
                trigGraphMap[tri] = new Set();
            }
            trigGraphMap[tri].add(this.tweet.id);
        });
    }
}

document.getElementById("file_upload").addEventListener("change", (event) => {
    const fileList = event.target.files;
    loadArchives(fileList);
});


//Handler for showing/hiding help + meta controls
document.getElementById("toggle_help").addEventListener("click", e => {
    help_div = document.getElementById("help_contents_div");
    if(help_div.style.display != "none"){
        help_div.style.display = "none";
        document.getElementById("toggle_help").innerHTML = "Show";
    } else {
        help_div.style.display = "block";
        document.getElementById("toggle_help").innerHTML = "Hide";
    }
});

//This is called to set the state of TWITTER_INTEGRATION_ON
//This also produces a TWITTER_INTEGRATION_CHANGE_EVENT
//on the document, in order to notify any listeners
//the state of twitter integration has changed
function checkTwitterIntegration(){
    buildAuthReq("GET", GET_USER_URL, {}, {}, (e => {
        if(!TWITTER_INTEGRATION_ON){
            document.dispatchEvent(new Event(TWITTER_INTEGRATION_CHANGE_EVENT));
        }
        TWITTER_INTEGRATION_ON = true;
        updateTwitterIntegrationDisplay();
    }), (e => {
        if(TWITTER_INTEGRATION_ON){
            document.dispatchEvent(new Event(TWITTER_INTEGRATION_CHANGE_EVENT));
        }
        TWITTER_INTEGRATION_ON = false;
        updateTwitterIntegrationDisplay();
    })
    );
}

//TODO - This should launch twitter integration features
document.addEventListener(TWITTER_INTEGRATION_CHANGE_EVENT, e => {
    console.log(e);
})

function updateTwitterIntegrationDisplay(){
    display = document.getElementById("twitter_integration_status")
    if(TWITTER_INTEGRATION_ON){
        display.innerHTML = "Twitter Integration Enabled :)";
    } else {
        display.innerHTML = "Twitter Integration Disabled <button id=\"twitter_auth\">Enable</button>";
    }
}

//checkTwitterIntegration();

//Stolen because it is absurd that this isn't this built into
//a language as bloated as this
//https://stackoverflow.com/questions/1527803/generating-random-whole-numbers-in-javascript-in-a-specific-range
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getColor(fileList){
    if(fileList.length == 1){
        return 0x000000;
    }
    this.callCount = this.callCount || 0;
    let res = RENDER_COLORS[this.callCount]
    this.callCount = (this.callCount + 1)%RENDER_COLORS.length;
    return res;
}

//Global archive count
//used to only load tweets
//and do main work
//after all filereader
//callbacks have fires
var filesToLoad = 0;

function loadArchives(fileList){
    if(fileList.length > RENDER_COLORS.length){
        alert("Sorry, only " + RENDER_COLORS.length + " Archives may be loaded at a time for now");
        return;
    }
    filesToLoad = fileList.length;
    for(let i = 0; i < fileList.length; i++){
        var r = new FileReader();
        r.addEventListener("load", e => {
            text = e.target.result;
            loadTweets(text, getColor(fileList), fileList[i].name);
            filesToLoad--;
            if(filesToLoad == 0){
                buildGraph();
            }
        })
        r.readAsText(fileList[i]);
    }
    setupArchiveSelect(fileList);
}

function loadTweets(text, color, archiveName){
    text = text.slice(text.indexOf("["));
    data = JSON.parse(text);
    flattenTweets(data).forEach((tweet) => {
        let t = new TweetWrapper(tweet, false, color, archiveName);//These tweets are being pulled from the archive, so not foreign
        loadedTweets[t.tweet.id] = t;
    });
}

function flattenTweets(data){
    flattened = [];
    data.forEach((t, i) => {
        t = t.tweet;
        tFlat = {
            "id" : t.id,
            "id_as_int" : parseInt(t.id),
            "timestamp" : new Date(t.created_at).getTime(),
            "timestring" : t.created_at,
            "text" : t.full_text,
            "reply_user_name" : t.in_reply_to_screen_name,
            "reply_user_id" : t.in_reply_to_user_id,
            "reply_tweet_id" : t.in_reply_to_status_id,
            "likes" : parseInt(t.favorite_count),
            "retweets" : parseInt(t.retweet_count),
            "urls" : t.entities.urls,
            "mentions" : t.entities.user_mentions
        }

        qts = []
        tFlat.urls.forEach((u) => {
            u = u.expanded_url;
            if(u.indexOf("twitter.com") > 0 && u.indexOf("/status/") > 0){
                chunks = u.split(".com/")[1].split("/");
                qt_user = chunks[0].trim();
                qt_id = chunks[2].split("?")[0].trim();
                qts.push({
                    "user" : qt_user,
                    "id" : qt_id
                });
            }
        });
        tFlat["quoting"] = qts;
        flattened.push(tFlat)
    });
    return(flattened);
}

function addEdgeToGlobalList(e){
    let fromId = e.from.tweet.id;
    let toId = e.to.tweet.id;
    if(e.class == "reply"){
        if(globalReplies[fromId]){
            globalReplies[fromId].add(toId);
        } else {
            globalReplies[fromId] = new Set([toId, ]);
        }
        if(globalReplies[toId]){
            globalReplies[toId].add(fromId);
        } else {
            globalReplies[toId] = new Set([fromId, ]);
        }
    } else {
        if(globalQuotes[fromId]){
            globalQuotes[fromId].add(toId);
        } else {
            globalQuotes[fromId] = new Set([toId, ]);
        }
        if(globalQuotes[toId]){
            globalQuotes[toId].add(fromId);
        } else {
            globalQuotes[toId] = new Set([fromId, ]);
        }
    }
}

function buildGraph(){
    renderGraph = Viva.Graph.graph(
        {options : {
            multigraph : true//Claims an 18% performance boost, have to ensure single link-per-node-pair
        }});
    edgeSets = []
    Object.keys(loadedTweets).forEach(id => {
        edgeSets.push(getEdges(loadedTweets[id]));
    });
    edgeSets.forEach(set =>{
        set.forEach(e => {
            addEdgeToGlobalList(e);
        });
    });
    Object.keys(loadedTweets).forEach(id => {
        addTweet(loadedTweets[id]);
    });
    var linkIds = new Set();
    edgeSets.forEach(set =>{
        set.forEach(e => {
            let fromTo = e.from.tweet.id + e.to.tweet.id;
            let toFrom = e.to.tweet.id + e.from.tweet.id;
            if(!linkIds.has(fromTo) && !linkIds.has(toFrom)){
                linkIds.add(fromTo);
                linkIds.add(toFrom);
                renderGraph.addLink(e.from.tweet.id, e.to.tweet.id, e);
            }
        });
    });
    launchNetworkRendering();
}

function addTweet(wrapper){
    if(!globalReplies[wrapper.tweet.id] && !globalQuotes[wrapper.tweet.id]) return;
    renderGraph.addNode(wrapper.tweet.id, wrapper);
}

function getEdges(wrapper){
    var edges = [];
    if(wrapper.replyId && loadedTweets[wrapper.replyId]){
        let replyWrapper = loadedTweets[wrapper.replyId];
        dt = Math.abs(wrapper.tweet.timestamp - replyWrapper.tweet.timestamp);
        let w = 1.5 * (1 + sigmoid(dt));
        edges.push({
            from: wrapper,
            to: loadedTweets[wrapper.replyId],
            weight: w,
            class: "reply"
        });
    }

    wrapper.quotes.forEach(id => {
        if(loadedTweets[id]){
            let otherWrapper = loadedTweets[id];
            dt = Math.abs(wrapper.tweet.timestamp - otherWrapper.tweet.timestamp);
            let w = 6 * (1 + sigmoid(dt));
            edges.push({
                from: wrapper,
                to: loadedTweets[id],
                weight: w,
                class: "quote"
            });
        }
    })
    return edges;
}

function cleanGraph(){
    renderGraph.forEachNode(n => {
        if(n.links == null){
            renderGraph.removeNode(n);
        }
    })
}

//All this does is start the renderer
function launchNetworkRendering(){

    var physicsSettings = {
        springLength: baseLength,
        springCoeff : springStrength,
        dragCoeff: drag,
        gravity: -1.0*repulsion,
        theta: 0.8,//Single biggest performance impacting value
        springTransform: (link, spring) => {
            spring.length = baseLength * link.data.weight;
            //spring.coeff = link.data.class == "reply" ? 0.0015 : 0.00000001;
        },
        nodeMass: nodeId => {
            let node = renderGraph.getNode(nodeId);
            return 1 + node.data.quotes.size/4;
        }
    }
    graphLayout = new WASMLayout(renderGraph, physicsSettings);

//Grab a webgl renderer
    graphics = Viva.Graph.View.webglGraphics();

//Setup default node rendering
    graphics.node(function(node) {
        return Viva.Graph.View.webglSquare(20, node.data.color);
    });

//Color links based on whether they're replies or quotes
    graphics.link(function (link) {
        color = link.data.class == "reply" ? REPLY_COLOR : QUOTE_COLOR;
        return Viva.Graph.View.webglLine(color);
    });

//Build a renderer with bog standard options
    renderer = Viva.Graph.View.renderer(renderGraph,
        {layout: graphLayout, graphics : graphics}
    );

//Grab the webGl events handler
    var events = Viva.Graph.webglInputEvents(graphics, renderGraph);

//Add custom events for the webGL even handler for nodes
    events.mouseEnter(function (node) {
        highlightNode(node, renderer, graphics, graphLayout);
    }).mouseLeave(function (node) {
        unHighlightNode(node, renderer, graphics);
    }).dblClick(function (node) {
        if(filterRules["subgraph_selected"]){
            delete filterRules["subgraph_selected"];
        } else {
            filterRules["subgraph_selected"] = n => {
                var subGraphNodes = new Set();
                getReplyNodes(node, subGraphNodes);
                return subGraphNodes.has(n.id);
            }
        }
        refreshActiveRender();
    }).click(function (node) {
    });
    document.addEventListener("keydown", event => {
        if(event.path[0] != document.body) return;
        if(event.key == "p"){
            if(!renderer.isPaused){
                pauseSim();
                renderer.isPaused = true;
            } else {
                resumeSim();
                renderer.isPaused = false;
            }
        }
        if(event.key == "q"){
            if(filterRules["only_quotes"]){
                delete filterRules["only_quotes"];
            } else {
                filterRules["only_quotes"] = node => {
                    if(globalQuotes[node.id]){
                        return true;
                    }
                    return false;
                };
            }
            refreshActiveRender();
        }
    });

    //console.log(renderGraph);
    //console.log(graphics);
    //console.log(graphLayout);
    //console.log(renderer);
    renderer.run();
}

function pauseSim(){
    renderer.pause();
}

function resumeSim(){
    renderer.resume();
}

function refreshActiveRender(){
    applyFilterRules();
    renderGraph.forEachNode( node => {
        ui = graphics.getNodeUI(node.id);
        if(!activeRenderNodes.has(node.id)){
            ui.color = node.data.dim_color;
        } else {
            ui.color = node.data.color;
        }
    });
    renderGraph.forEachLink(link => {
        ui = graphics.getLinkUI(link.id);
        if(activeRenderNodes.has(link.fromId) || activeRenderNodes.has(link.toId)){
            ui.color = link.data.class == "reply" ? REPLY_COLOR : QUOTE_COLOR;
        } else {
            ui.color = link.data.class == "reply" ? REPLY_COLOR_DIM : QUOTE_COLOR_DIM;
        }
    });
    renderer.rerender();
}

function applyFilterRules(){
    activeRenderNodes.clear();
    renderGraph.forEachNode(node => {
        let add = true;
        Object.keys(filterRules).forEach(ruleName => {
            let rule = filterRules[ruleName];
            add = add && rule(node);
        });
        if(add){
            activeRenderNodes.add(node.id);
        }
    });
    refreshRuleSetDisplay();
}

function highlightNode(node, renderer, graphics, layout){
    if(!activeRenderNodes.has(node.id) && Object.keys(filterRules).length > 0){return;}
    var pos = {};
    pos.x = layout.getNodePosition(node.id).x;
    pos.y = layout.getNodePosition(node.id).y;
    drawNodeInfo(node, graphics.transformGraphToClientCoordinates(pos));
    ui = graphics.getNodeUI(node.id);
    ui.color = NODE_HIGHLIGHTED_COLOR;
    renderer.rerender();
}

function unHighlightNode(node, renderer, graphics){
    hideNodeInfo(node);
    ui = graphics.getNodeUI(node.id);
    if(!activeRenderNodes.has(node.id) && Object.keys(filterRules).length > 0){
        ui.color = node.data.dim_color;
    } else {
        ui.color = node.data.color;
    }
    renderer.rerender();
}

function highlightSubgraph(node){
    activeRenderNodes.clear();
    var subGraphNodes = new Set();
    getReplyNodes(node, subGraphNodes);
    refreshActiveRender();
}

function unHighlightSubgraph(renderer, graph, graphics){
    activeRenderNodes.clear();
    refreshActiveRender();
}

function drawNodeInfo(node, pos){
    node.data.info_showing = true;
    el = document.getElementById("tweet_info");
    el.style.top = pos.y + 15;
    el.style.left = pos.x + 15;
    el.innerHTML = getTweetInfoString(node);
}

function getTweetInfoString(node){
    link = "<a href=\"https://twitter.com/i/web/status/" + node.data.tweet.id + "\" target=\"blank\">link</a><br/>";
    text = node.data.tweet.text + "</br>";
    likes = "Likes: " + node.data.tweet.likes + "<br/>";
    rts = "Retweets: " + node.data.tweet.retweets + "<br/>";
    time = node.data.tweet.timestring;
    return link + text + likes + rts + time;
}

function hideNodeInfo(node){
    node.data.info_showing = false;
    el = document.getElementById("tweet_info").innerHTML = "";
}

//Cheeky lil dfs how are ya?
function getReplyNodes(node, known){
    known.add(node.id);
    if(!globalReplies[node.id]) return known;
    globalReplies[node.id].forEach(reply => {
        if(!known.has(reply)){
            getReplyNodes(renderGraph.getNode(reply), known);
        }
    })
    return known;
}

document.getElementById("twitter_auth").addEventListener("click", e => {
    runTwitterLogin();
})

function runTwitterLogin(){
    req = new XMLHttpRequest();
    req.open("GET", TWEETGRAPH_API + "getUrl");
    req.addEventListener("error", e => {
        console.log(e);
    });

    req.addEventListener("abort", e=>{
        console.log(e);
    });

    req.addEventListener("load", e => {
        console.log(e);
//This untested parse is fine because getUrl should never return an error
//We want to fail as quickly and loudly as possible
        response = JSON.parse(e.target.response);
        useTwitterLoginUrl(response);
    });
    req.send();
}

function useTwitterLoginUrl(response){
    url = response.url;
    document.getElementById("twitter_auth_link").setAttribute("href", url);
    document.getElementById("twitter_login_box").style.display = "block"
    document.getElementById("twitter_passcode_button").addEventListener("click", e => {
        oauth_verifier = document.getElementById("twitter_passcode_field").value;
        oauth_token = response.oauth_token;
        getAccessToken(oauth_verifier, oauth_token);
    })
}

function getAccessToken(oauth_verifier, oauth_token){
    req = new XMLHttpRequest();
    var reqParams = {};
    reqParams["oauth_verifier"] = oauth_verifier;
    reqParams["oauth_token"] = oauth_token;
    req.open("GET", TWEETGRAPH_API + "getAccessToken" + formatParams(reqParams));
    req.addEventListener("error", e => {
        console.log(e);
    });

    req.addEventListener("abort", e=>{
        console.log(e);
    });

    req.addEventListener("load", e => {
        if(e.target.status >= 400){
//TODO - replace this with a valid error handling function
//Maybe an alert like "something went wrong, please try again"
//and then calling runTwitterLogin again to get a fresh url?
            console.log(e);
            return;
        }
        response = JSON.parse(e.target.response);
        handleAccessData(response);
    });
    req.send();
}

//stolen from https://stackoverflow.com/questions/8064691/how-do-i-pass-along-variables-with-xmlhttprequest
function formatParams( params ){
    if(Object.keys(params).length < 1){
        return("");
    }
    return "?" + Object
        .keys(params)
        .map(function(key){return key+"="+encodeURIComponent(params[key])
        }).join("&");
}

function handleAccessData(res){
    screen_name = res.screen_name;
    oauth_token = res.oauth_token;
    user_id = res.user_id;
    window.localStorage.setItem("screen_name", screen_name);
    window.localStorage.setItem("oauth_token", oauth_token);
    window.localStorage.setItem("user_id", user_id);

//Hide the login box
    document.getElementById("twitter_login_box").style.display = "none";
//Now that we know consumer key, screen name, oauth access token and user id are
//stored in localstorage, we can verify twitter integration and run
    checkTwitterIntegration();
//TODO - this is where we'd start re-generating the graph
//if it already exists, pulling down foreign nodes,
//pulling a users latest 3000 tweets, etc
}

//Used to sign a request to be run against twitters api
//If request signing succeeds, will then run the request against
//the twitter api. Failure at any stage calls the failure callback
//with the event as the only argument. Successful calls to twitters
//api result in the load event being passed to the success callback
//Failure is defined as "abort", "error" or a status >= 400
function buildAuthReq(method, url, urlParams, bodyParams, success, failure){
    failure = failure || ((e) => {console.log(e)});
    reqData = {};
    reqData["method"] = method;
    reqData["url"] = url;
    reqData["urlParams"] = urlParams;
    reqData["bodyParams"] = bodyParams;
//The server already has everything except the oauth token, which identifies this user
//(the server could technically also store the oauth token and then use some other method
//to identify users, but this works just as well)
    reqData["oauthToken"] = window.localStorage.getItem("oauth_token");
//These may be used for logging
    reqData["screenName"] = window.localStorage.getItem("screen_name");
    reqData["userId"] = window.localStorage.getItem("user_id");
    req = new XMLHttpRequest();
    req.open("POST", TWEETGRAPH_API + "signRequest");
    req.addEventListener("error", e => {
        failure(e);
    });
    req.addEventListener("abort", e=>{
        failure(e);
    });
    req.addEventListener("load", e => {
        if(e.target.status >= 400){
            failure(e);
            return;
        }
        runAuthReq(e, method, url, urlParams, bodyParams, success, failure)
    });
    req.send(JSON.stringify(reqData));
}

//Used to run a signed request against twitters api
//This should rarely be run manually, buildAuthReq'sts success
//callback calls it automatically when the signing process succeeds
function runAuthReq(authEvent, method, url, urlParams, bodyParams, success, failure){
    success = success || ((e) => {console.log(e)});
    failure = failure || ((e) => {console.log(e)});
    if(authEvent.target.status >= 500){
        console.log(authEvent);
        return;
    }
    authEventData = JSON.parse(authEvent.target.response);
    bodyParams = formatParams(bodyParams);
    headers = {
        Authorization : authEventData["Authorization"]
    }
    req = buildRequest(method, url, headers, urlParams, success, failure);
    req.send(bodyParams);
}

function buildRequest(method, url, headers, urlParams, success, failure){
    success = success || ((e) => {console.log(e)});
    failure = failure || ((e) => {console.log(e)});
    req = new XMLHttpRequest();
    req.open(method, url + formatParams(urlParams));
    Object.keys(headers).forEach(k => {
        req.setRequestHeader(k, headers[k]);
    })
    req.addEventListener("error", e => {
        failure(e);
    });
    req.addEventListener("abort", e=>{
        failure(e);
    });
    req.addEventListener("load", e => {
        success(e);
    });
    return req;
}

function setupArchiveSelect(fileList){
    s = ""; 
    for(let i = 0; i < fileList.length; i++){
        let f = fileList[i];
        let selectorId = "highlightSelectorFor" + f.name;
        s += "<input type='checkbox' class='archiveSelectorCheckbox' value='" + f.name + "'"
        s += " id='" +  selectorId + "' checked>";
        s += "<label for='" + selectorId + "'>" + f.name + "</label><br>";
    }
    document.getElementById("archive_highlight_div").innerHTML = s;
    document.querySelectorAll(".archiveSelectorCheckbox").forEach(el => {
        el.addEventListener("change", e => {
            refreshArchiveHighlightSelect();
        })
    })
}

function refreshArchiveHighlightSelect(){
    var selectedArchives = new Set();
    document.querySelectorAll(".archiveSelectorCheckbox:checked").forEach(el => {
        selectedArchives.add(el.value);
    });
    filterRules["archive_select"] = node => {
        return selectedArchives.has(node.data.archiveName);
    }
    refreshActiveRender();
}

//lets build search boiiii

function getTriGraphs(str){
    str = str.toLowerCase();
    var res = []
    if(str.length < 3){
        return [str, ];
    }
    for(let i = 2; i < str.length; i++){
        res.push(str[i-2] + str[i-1] + str[i]);
    }
    return res;
}

document.getElementById("tweet_search_input").addEventListener("input", async e => {
    refreshSearchFilterRule();
})

async function refreshSearchFilterRule(){
    term = document.getElementById("tweet_search_input").value.toLowerCase();
    if(term.length < 3 || !renderGraph){
        if(filterRules["search"]) delete filterRules["search"];
    } else {
        let tris = getTriGraphs(term);
        var intersection = new Set(trigGraphMap[tris[0]]);
        getTriGraphs(term).forEach(tri => {
            if(trigGraphMap[tri]){
                let matching = trigGraphMap[tri];
                intersection = new Set([...intersection].filter(x => matching.has(x)));
            }
        });
        filterRules["search"] = (node => {
            if(intersection.has(node.id)){
                return node.data.tweet.text.toLowerCase().indexOf(term) > 0;
            }
            return false;
        });
    }
    refreshActiveRender();
}

function refreshRuleSetDisplay(){
    var ruleSetDisplayDiv = document.getElementById("rule_set_div");
    var ruleSetDisplayList = document.getElementById("rule_set_list");
    ruleSetDisplayDiv.style.display = Object.keys(filterRules).length > 0 ? "block" : "none";
    s = "";
    Object.keys(filterRules).forEach(rName => {
        s += "<li>" + rName + "</li>";
    });
    ruleSetDisplayList.innerHTML = s;
}