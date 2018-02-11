$( document ).ready(function() {
    $.getJSON('/json', function(data){
        var events = data.events.map(function(ev){
            return {
                "start" : ev.start_time,
                "end" : ev.end_time,
                "url" : "#" + ev.id,
                "title" : ev.name,
                "description": ev.description
            }
        })
        $("#calendar").fullCalendar({
            header: {
                left: 'prev,next today',
                center: 'title',
                right: 'month,basicWeek,basicDay'
            },
            navLinks: true, // can click day/week names to navigate views
            events: events,
            eventRender: function(event, element) {
                //TODO: does it escape quotes?
                element.attr('title', event.description.substring(0, 260) + "...");
            }
        });
    })
});