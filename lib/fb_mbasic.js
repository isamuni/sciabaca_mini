const axios = require("axios");
const cheerio = require("cheerio");
const eventregex = /^\/events\/(\d+).*/;

function buildURL(pagename){
    if(!pagename){
        throw "no pagename provided"
    }
    return `https://mbasic.facebook.com/${pagename}?v=events`
}

function eventIDFromEventUrl(eventUrl){
    let result = eventregex.exec(eventUrl);
    if(result){
        return result[1];
    }
}

function mapCollect(fn, ary){
    let res = new Set();
    for(let e of ary){
        let r = fn(e);
        if(r){
            res.add(r);
        }
    }
    return res;
}

async function getEventIDs(pagename){
    const url = buildURL(pagename);
    const response = await axios.get(url);
    if(response.status == 200){
        console.log(response.data);
        
        let $ = cheerio.load(response.data);
        let links = $('a').map(function(i, e){ return $(e).attr("href")}).get();
        console.log(links);
        let ids = mapCollect(eventIDFromEventUrl, links);
        return ids;
    }
    return new Set();
}

module.exports = {
    getEventIDs
};