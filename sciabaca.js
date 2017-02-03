let Promise = require("bluebird");
var express = require('express');
let geolib = require("geolib");
let Sequelize = require('sequelize');
let {Facebook} = require('fb');

let app = express();
app.set('view engine', 'pug');

// we'll use an in-memory database, that gets resetted every time we fetch events
let sequelize = new Sequelize('sqlite:', {dialect: 'sqlite'});

// istantiate facebook api, api token is the one of isamuni_squirrel
let FB = new Facebook();
FB.setAccessToken(process.env["FACEBOOK_API_TOKEN"]);

// event fields to fetch from facebook
const EVENT_FIELDS = "id,name,description,start_time,end_time,updated_time,place,parent_group,owner";

// schema definition of our database
var Event = sequelize.define('event', {
  id: { type: Sequelize.STRING, primaryKey: true},
  name: Sequelize.STRING,
  description: Sequelize.STRING,
  start_time: Sequelize.DATE,
  end_time: Sequelize.DATE,
  updated_time: Sequelize.DATE,
  place: Sequelize.STRING,
  latitude: Sequelize.STRING,
  longitude: Sequelize.STRING,
  parent_group: Sequelize.STRING,
  owner: Sequelize.STRING,
  nearest_place: Sequelize.STRING
});

// load from file the list of sources and the list of places
const sources = require('./sources.json');
const capoluoghi = require('./capoluoghi.json');

// Helper functions
/////////////////////

function nearestPlace(lat, lon){
  //finds place nearest to some given coordinates

  let nearestP = capoluoghi[0];
  let nearestDistance = 10000000000;
  for (let c of capoluoghi){
    let distance = geolib.getDistance(
        {latitude: lat, longitude: lon},
        {latitude: c[2], longitude: c[3]}
    );
    if(distance < nearestDistance){
      nearestDistance = distance;
      nearestP = c;
    };
  }
  return nearestP;
}

function makeGetRequest(url){
  // makes an object representing a get request
  return { method: 'get', relative_url: url }
}

function eventIDFromLink(link){
  // extracts an event's id given its facebook link

  let res = /www.facebook.com\/events\/(\d+)/.exec(link)
  if (res) return res[1];
}

function batchRequests(batch){
  // makes a call to facebook's api, executing various requests in batch

  return new Promise(function(resolve, reject) {
      FB.api('','post',{batch: batch}, function(res){
          if(!res || res.error) {
              reject(res.error);
          } else {
              resolve(res);
          }
      });
   });
}

// Main Crawling Function (async)
/////////////////////////////////

function *crawl(){
  console.log("crawling");
  let events = {}; // id -> event_data

  let page_requests = sources.fb.pages
      .map(p => makeGetRequest(`/${p.id}/events?fields=${EVENT_FIELDS}`))

  let group_requests = sources.fb.groups
      .map(g => makeGetRequest(`/${g.id}/feed?limit=100&fields=link,type`));

  //take events from pages
  let page_events_replies = yield batchRequests(page_requests);
  for (const reply of page_events_replies) {
    let events_in_page = JSON.parse(reply.body);
    for (const event of events_in_page.data){
        events[event.id] = event;
    }
  }

  //take event ids from groups
  let feed_replies = yield batchRequests(group_requests);
  for (const reply of feed_replies) {
    let feed = JSON.parse(reply.body);
    for (const post of feed.data){
      if (post.type == "event"){
        let postid = eventIDFromLink(post.link);
        if (!events[postid]) events[postid] = null;
      }
    }
  }

  //take remaining events
  let event_requests = Object.keys(events).filter(i=>events[i] == null)
    .map(i => makeGetRequest(`/${i}?fields=${EVENT_FIELDS}`))

  let events_replies = yield batchRequests(event_requests);
  for (const reply of events_replies) {
    let event = JSON.parse(reply.body);
    if(event && event.id)
      events[event.id] = event;
    else
      console.error("unkown error with event", event);
  }

  //postprocessing events
  let processedEvents = [];
  for( let i in events ){
    let e = events[i];

    if (e.place && e.place.location){
      let p = e.place.location;
      e.nearest_place = nearestPlace(p.latitude, p.longitude)[0];
    } else {
      console.warn("event without place or location", e);
    }

    e.place = JSON.stringify(e.place);
    e.owner = JSON.stringify(e.owner);
    e.parent_group = JSON.stringify(e.parent_group);

    processedEvents.push(e);
  }

  yield Event.destroy({where: {}});
  yield Event.bulkCreate(processedEvents);

  console.log("finished crawling");
}

// Webserver logic
////////////////////////////////////////////////

app.get('/', function (req, res) {
  let query = {where: {start_time: {$gt: new Date()}}};

  if(req.query.places){
    query.where.nearest_place = {$in: eq.query.places.split(",")}
  }

  Promise.coroutine(function*(){
    let event_places_count = yield Event.findAll({
      where: {start_time: {$gt: new Date()}},
      attributes: ['nearest_place', [sequelize.fn('COUNT', sequelize.col('id')), 'events']],
      group: ['nearest_place']
    });

    let events = yield Event.findAll(query)
    res.send(JSON.stringify(event_places_count) + "\n\n" + JSON.stringify(events));
    //res.render('index', {events: events, event_places_count: event_places_count});
  })();
})


// Startup logic
////////////////////////////////////////////

function perform_crawling(){
  Promise.coroutine(crawl)();
}

//sync db, then
sequelize.sync().then(function() {

  // start server
  app.listen(3000, function () {
    console.log('Example app listening on port 3000!')
  })

  //crawl
  perform_crawling();

  //reschedule crawling every two hours
  setInterval(perform_crawling, 1000* 3600 * 2);
});
