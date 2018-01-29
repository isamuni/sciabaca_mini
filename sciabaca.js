let fs = require('fs');
var express = require('express');
let geolib = require("geolib");
let Sequelize = require('sequelize');
let {
  Facebook
} = require('fb');
let cors = require('cors');
let basicAuth = require('express-basic-auth');
let bodyParser = require('body-parser')
let configAuth = basicAuth({
  users: {
    admin: process.env['ADMIN_PASS'] || "password"
  },
  challenge: true
});
let ical = require('ical-generator');
var moment = require('moment');
require("moment/min/locales.min");

let app = express();
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(express.static('public'))
app.use(cors());
app.set('json spaces', 2);
app.set('view engine', 'pug');

let PORT = process.env["PORT"] || 3000;
let dbConnectionURI = process.env['DATABASE_URL'] || 'sqlite:data/database.db';
let sequelize = new Sequelize(dbConnectionURI, {logging: false});

// istantiate facebook api, api token is the one of isamuni_squirrel
let FB = new Facebook();
let FBTOKEN = process.env["FACEBOOK_API_TOKEN"];
if (FBTOKEN) {
  FB.setAccessToken(FBTOKEN);
}

// event fields to fetch from facebook
const EVENT_FIELDS = "id,name,description,start_time,end_time,updated_time,place,parent_group,owner";

// schema definition of our database
var Event = sequelize.define('event', {
  id: {
    type: Sequelize.STRING,
    primaryKey: true
  },
  name: Sequelize.STRING,
  description: Sequelize.TEXT,
  start_time: Sequelize.DATE,
  end_time: Sequelize.DATE,
  updated_time: Sequelize.DATE,
  place: Sequelize.JSON,
  latitude: Sequelize.STRING,
  longitude: Sequelize.STRING,
  parent_group: Sequelize.JSON,
  owner: Sequelize.JSON,
  nearest_place: Sequelize.STRING,
  url: Sequelize.STRING
});

var Config = sequelize.define('config', {
  id: {
    type: Sequelize.STRING,
    primaryKey: true
  },
  value: Sequelize.TEXT
})

// load from file the list of sources and the list of places
let config = {}

async function loadConfig() {
  let configFile;
  try {
    let configDB = await Config.find({
      where: {
        id: 'config'
      }
    });
    configFile = JSON.parse(configDB.value);
  } catch (error) {
    console.error("unable to read config from database, falling back to shipped config " + error);
    configFile = JSON.parse(fs.readFileSync('./config.json'));
  }
  
  for(let i in configFile){
    config[i] = configFile[i];
  }
}

function saveConfig(config) {
  return Config.insertOrUpdate({
    id: 'config',
    value: JSON.stringify(config)
  })
}

const capoluoghi = require('./capoluoghi.json');

// Helper functions
/////////////////////

function nearestPlace(lat, lon) {
  //finds place nearest to some given coordinates
  if(!config.aggregate_places){
    return null;
  }

  let nearestP = capoluoghi[0];
  let nearestDistance = 10000000000;
  for (let c of capoluoghi) {
    let distance = geolib.getDistance({
      latitude: lat,
      longitude: lon
    }, {
      latitude: c[2],
      longitude: c[3]
    });
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestP = c;
    };
  }
  return nearestP;
}

function getRequestObj(url) {
  // makes an object representing a get request
  return {
    method: 'get',
    relative_url: url
  }
}

function eventURLFromID(id){
  return `https://www.facebook.com/events/${id}`;
}

function eventIDFromLink(link) {
  // extracts an event's id given its facebook link

  let res = /www.facebook.com\/events\/(\d+)/.exec(link)
  if (res) return res[1];
}

function sendRequestsBatch(batch) {
  // makes a call to facebook's api, executing various requests in batch

  return new Promise(function (resolve, reject) {
    FB.api('', 'post', {
      batch: batch
    }, function (res) {
      if (!res || res.error) {
        reject(res.error);
      } else {
        resolve(res);
      }
    });
  });
}

// Main Crawling Function (async)
/////////////////////////////////

async function crawl() {
  console.log("crawling");

  let page_requests = config.sources.fb.pages
    .map(p => getRequestObj(`/${p.id}/events?fields=${EVENT_FIELDS}`))

  let group_requests = config.sources.fb.groups
    .map(g => getRequestObj(`/${g.id}/feed?limit=100&fields=link,type`));

  //resulting event map, indexed by ID
  let events = Object.create(null);

  //take events from pages
  let page_events_replies = await sendRequestsBatch(page_requests);
  for (const reply of page_events_replies) {
    let events_in_page = JSON.parse(reply.body);
    for (const event of events_in_page.data) {
      events[event.id] = event;
    }
  }

  //take events from groups (only ids)
  let feed_replies = await sendRequestsBatch(group_requests);
  for (const reply of feed_replies) {
    let feed = JSON.parse(reply.body);
    for (const post of feed.data) {
      if (post.type == "event") {
        let postid = eventIDFromLink(post.link);
        if (!events[postid]) events[postid] = null;
      }
    }
  }

  //take remaining events
  let event_requests = Object.keys(events).filter(i => events[i] == null)
    .map(i => getRequestObj(`/${i}?fields=${EVENT_FIELDS}`))

  let events_replies = await sendRequestsBatch(event_requests);
  for (const reply of events_replies) {
    let event = JSON.parse(reply.body);
    if (event && event.id)
      events[event.id] = event;
    else
      console.error("unkown error with event", event);
  }

  //postprocessing events
  let processedEvents = [];
  for (let i in events) {
    let e = events[i];

    if (e.place && e.place.location) {
      let p = e.place.location;
      let np = nearestPlace(p.latitude, p.longitude);
      if (np)
        e.nearest_place = np[0];
    } else {
      console.warn("event without place or location", e);
    }

    //e.place = JSON.stringify(e.place);
    //e.owner = JSON.stringify(e.owner);
    //e.parent_group = JSON.stringify(e.parent_group);

    e.url = eventURLFromID(i);
    processedEvents.push(e);
  }

  //Destroy events we are about to re-insert
  await Event.destroy({
    where: {
      id: {
        $in: processedEvents.map(ev => ev.id)
      }
    }
  });

  //Reinsert event
  await Event.bulkCreate(processedEvents);

  console.log("finished crawling");
}

// Webserver logic
////////////////////////////////////////////////

app.get('/config', configAuth, function (req, res) {
  res.render("config", {
    config: JSON.stringify(config, null, 2)
  })
})

app.post('/config', configAuth, async function (req, res) {

  let message = "success";

  try {
    await saveConfig(JSON.parse(req.body.config));
    await loadConfig();
    await crawl();
  } catch (error) {
    console.error(error)
    message = "error " + error
  }

  res.render("config", {
    config: JSON.stringify(config, null, 2),
    message: message
  });
})

app.get('/', async function(req,res){
  moment.locale(config.locale);

  let query = {
    where: {
      end_time: {
        $gt: new Date()
      }
    }
  };

  let events = await Event.findAll(query)
  res.render("index", {
    events, config, moment
  });
});

app.get('/ical', async function(req,res){
  let query = {
    where: {
      end_time: {
        $gt: new Date()
      }
    }
  };

  let events = await Event.findAll(query)

  let cal = ical({name: config.calendar_name, domain: config.domain, timezone: 'Europe/Rome'})

  for(let e of events){
    cal.createEvent({
      start: e.start_time,
      end: e.end_time,
      summary: e.name,
      description: e.description,
      location: e.place.name,
      url: e.url
    });
  }

  cal.serve(res);
});

app.get('/json', async function (req, res) {
  let query = {
    where: {
      start_time: {
        $gt: new Date()
      }
    }
  };

  if (req.query.places) {
    query.where.nearest_place = {
      $in: eq.query.places.split(",")
    }
  }

  let event_places_count = await Event.findAll({
    where: {
      start_time: {
        $gt: new Date()
      }
    },
    attributes: ['nearest_place', [sequelize.fn('COUNT', sequelize.col('id')), 'events']],
    group: ['nearest_place']
  });

  let events = await Event.findAll(query)
  res.json({
    places: event_places_count,
    events: events
  });

  //res.render('index', {events: events, event_places_count: event_places_count});
})

async function perform_crawling() {
  try {
    if (FBTOKEN) {
      await crawl();
    } else {
      console.error("FACEBOOK_API_TOKEN not set");
    }
  } catch (error) {
    console.error(error);
  }
}

// Startup logic
////////////////////////////////////////////

//sync db, then
sequelize.sync().then(async function () {
  
  await loadConfig();
  await perform_crawling();

  // start server
  app.listen(PORT, function () {
    console.log('Example app listening on port ' + PORT)
  })

  //reschedule crawling every two hours
  //note this may not work on heroku
  setInterval(perform_crawling, 1000 * 3600 * 4);
});