let fs = require('fs');
var express = require('express');
let geolib = require("geolib");
let Sequelize = require('sequelize');
const Op = Sequelize.Op

let cors = require('cors');
let basicAuth = require('express-basic-auth');
let bodyParser = require('body-parser');

let { Facebook } = require('fb');

const fb_mbasic = require("./lib/fb_mbasic");
const _fb_api = require("./lib/fb_api");

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
app.use(bodyParser.urlencoded({extended: false}));
app.use(express.static('public'))
app.use(cors());
app.set('json spaces', 2);
app.set('view engine', 'pug');

const handleErr = fn =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next))
      .catch(next);
  };

if (!fs.existsSync('data')){
  fs.mkdirSync('data');
}

let PORT = process.env["PORT"] || 3000;
let dbConnectionURI = process.env['DATABASE_URL'] || 'sqlite:data/database.db';
let sequelize = new Sequelize(dbConnectionURI);

// instantiate facebook api
let FB = new Facebook();
let FBTOKEN = process.env["FACEBOOK_API_TOKEN"];
if (FBTOKEN) {
  FB.setAccessToken(FBTOKEN);
}
const fb_api = new _fb_api.FBApi(FB);

// event fields to fetch from facebook

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
  url: Sequelize.STRING,
  source_site: Sequelize.STRING,
  crawling_time: Sequelize.DATE,
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

function emptyDatabase(){
  return Event.destroy({where:{}})
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


const QUERY_FUTURE_EVENTS = {
  where: {
    [Op.or] : [
      {
        end_time: { [Op.gt]: new Date() }
      },
      {
        start_time: { [Op.gt]: new Date() }
      }
    ]
  },
  order: sequelize.col('start_time')
};

function mergeSets(arrayOfSets){
  let res = new Set();
  for(let set of arrayOfSets){
    for(let i of set.values()){
      res.add(i);
    }
  }
  return res;
}

// Main Crawling Function (async)
/////////////////////////////////


async function crawl() {
  console.log("crawling");
  const crawlingTime = new Date();

  let pageIDPromises = config.sources.fb.pages.map(p => fb_mbasic.getEventIDs(p.id));
  let idsForPages = await Promise.all(pageIDPromises);
  let ids = mergeSets(idsForPages);
  let events = await fb_api.getEvents(ids.values());

  //postprocessing events
  let processedEvents = [];
  for (let i in events) {
    let e = events[i];

    if (e.place && e.place.location) {
      let p = e.place.location;
      let np = nearestPlace(p.latitude, p.longitude);
      if (np){
        e.nearest_place = np[0];
      }
    } else {
      //console.warn("event without place or location", e);
    }

    //e.place = JSON.stringify(e.place);
    //e.owner = JSON.stringify(e.owner);
    //e.parent_group = JSON.stringify(e.parent_group);

    e.source_site = "facebook";
    e.url = eventURLFromID(i);
    e.crawling_time = crawlingTime;

    if (e.event_times){
      //it is a nested event
      for(let subevent of e.event_times) {
        //replace id, start_time and end_time
        //warning: mind it's a shallow copy, but it's enough
        let clonedEvent = Object.assign({}, e);
        clonedEvent.id = subevent.id;
        clonedEvent.start_time = subevent.start_time;
        clonedEvent.end_time = subevent.end_time;
        processedEvents.push(clonedEvent);
      }
    } else {
      processedEvents.push(e);
    }
  }

  //Destroy events we are about to re-insert
  //Or new events from facebook (assuming they have been cancelled)
  await Event.destroy({
    where: {
      [Op.or]: [
        {
          start_time: { [Op.gt]: new Date() },
          source_site: "facebook"
        },
        {
          id: {
            [Op.in]: processedEvents.map(ev => ev.id)
          }
        }
      ]
    }
  });

  //Reinsert event
  await Event.bulkCreate(processedEvents);

  console.log("finished crawling");
}

// Webserver logic
////////////////////////////////////////////////

app.post('/config/reset', configAuth, handleErr(async function(req,res){
  await emptyDatabase();
  res.send("done");
}));

app.get('/config', configAuth, function (req, res) {
  res.render("config", {
    config: JSON.stringify(config, null, 2)
  })
});

app.post('/config', configAuth, async function (req, res) {

  let message = "success";

  try {
    await saveConfig(JSON.parse(req.body.config));
    await loadConfig();
    await crawl();
  } catch (error) {
    console.error(error)
    message = "error " + error.message
  }

  res.render("config", {
    config: JSON.stringify(config, null, 2),
    message: message
  });
});

app.get('/', handleErr(async function(req,res){
  moment.locale(config.locale);

  let events = await Event.findAll(QUERY_FUTURE_EVENTS)
  res.render("index", { events, config, moment });
}));

app.get('/ical', handleErr(async function(req,res){

  let events = await Event.findAll(QUERY_FUTURE_EVENTS)
  let cal = ical({name: config.calendar_name, domain: config.domain, timezone: 'Europe/Rome'})
  
  for(let e of events){
    const placeName = e.place? e.place.name : "" ;
    cal.createEvent({
      start: e.start_time,
      end: e.end_time,
      summary: e.name,
      description: e.description,
      location: placeName,
      url: e.url
    });
  }

  cal.serve(res);
}));

app.get('/json', handleErr(async function (req, res) {
  let query = {};
  query.order = QUERY_FUTURE_EVENTS.order;
  query.where = Object.assign({}, QUERY_FUTURE_EVENTS.where);

  if (req.query.places) {
    query.where.nearest_place = {
      [Op.in]: eq.query.places.split(",")
    }
  }

  let event_places_count = await Event.findAll({
    where: QUERY_FUTURE_EVENTS.where,
    attributes: ['nearest_place', [sequelize.fn('COUNT', sequelize.col('id')), 'events']],
    group: ['nearest_place']
  });

  let events = await Event.findAll(query)
  res.json({
    places: event_places_count,
    events: events
  });

  //res.render('index', {events: events, event_places_count: event_places_count});
}));

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
    console.log('Sciabaca listening on port ' + PORT)
  })

  //reschedule crawling every hour
  //note this may not work on heroku
  setInterval(perform_crawling, 1000 * 60 * 60);
});