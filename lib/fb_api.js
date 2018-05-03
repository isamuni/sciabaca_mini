const EVENT_FIELDS = "id,name,description,start_time,end_time,updated_time,place,parent_group,owner,event_times";

const getRequestObj = (url) => ({method:'get', relative_url: url});
const eventURLFromID = (id) => `https://www.facebook.com/events/${id}`;

function eventIDFromLink(link) {
    // extracts an event's id given its facebook link
    let res = /www.facebook.com\/events\/(\d+)/.exec(link)
    if (res) return res[1];
}

function iterMap(iter, fn){
    let res = [];
    for(let i of iter){
        let r = fn(i);
        if(r)
            res.push(r)
    }
    return res;
}

class FBApi {
    constructor(FB){
        this.FB = FB;
    }

    async eventIDsFromGroups(groups){
        let ids = new Set();

        //take events from groups (only ids)
        let feed_replies = await this.sendRequestsBatch(group_requests);
        let group_requests = groups.map(g =>
            getRequestObj(`/${g.id}/feed?limit=100&fields=link,type`));
        
        feed_replies.forEach((reply, index) => {
            const group = groups[index];
            let feed = JSON.parse(reply.body);
            if(!feed.data){
                console.warn("received no feed for group " + group.name);
                return;
            }
            for (const post of feed.data) {
                if (post.type == "event") {
                    let postid = eventIDFromLink(post.link);
                    ids.add(postid);
                }
            }
        })

        return ids;
    }

    async eventsFromPages(pages){
        let events = Object.create(null);

        //take events from pages
        let page_requests = pages.map(p =>
            getRequestObj(`/${p.id}/events?fields=${EVENT_FIELDS}`));

        let page_events_replies = await this.sendRequestsBatch(page_requests);
        for (const reply of page_events_replies) {
          let events_in_page = JSON.parse(reply.body);
          if(!events_in_page.data){
            console.error("error loading events from a page:");
            console.error(events_in_page);
            continue;
          }
          for (const event of events_in_page.data) {
            events[event.id] = event;
          }
        }

        return events;
    }

    sendRequestsBatch(batch) {
        // makes a call to facebook's api, executing various requests in batch
        return new Promise((resolve, reject) => {
            this.FB.api('', 'post', {
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

    //take remaining 
    async getEvents(ids){
        let event_requests = iterMap(ids, i =>
            getRequestObj(`/${i}?fields=${EVENT_FIELDS}`))
        console.log(event_requests);
        let events_replies = await this.sendRequestsBatch(event_requests);
        for (const reply of events_replies) {
            let event = JSON.parse(reply.body);
            if (event && event.id)
                events[event.id] = event;
            else
                console.error("unknown error with event", event);
        }
    }
}

module.exports = {
    FBApi
}