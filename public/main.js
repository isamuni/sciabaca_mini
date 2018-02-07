$( document ).ready(function() {
    $.getJSON('/json', function(data){
        var events = data.events.map(function(ev){
            return {
                "start" : ev.start_time,
                "end" : ev.end_time,
                "url" : "#" + ev.id,
                "title" : ev.name
            }
        })
        $("#calendar").fullCalendar({
            header: {
                left: 'prev,next today',
                center: 'title',
                right: 'month,basicWeek,basicDay'
            },
            navLinks: true, // can click day/week names to navigate views
            events: events
        });
    })
});