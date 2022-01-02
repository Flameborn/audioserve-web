function broadcastMessage(msg) {
    self.clients.matchAll().then((clients) => {
        console.log(`Got (${msg}) ${clients.length} clients`);
        for (const c of clients) {
            console.log(`Sending ${msg} to client ` + JSON.stringify(c));
            c.postMessage({ txt: "Here is your worker" });
        }
    });
}
self.addEventListener('install', (evt) => {
    console.log("Instalation successful");
});
self.addEventListener('activate', (evt) => {
    console.log("Activation successful");
    broadcastMessage("on activate");
});
self.addEventListener('message', (evt) => {
    console.log("Got message", evt.data, evt.source);
    broadcastMessage("as reply");
});
self.addEventListener('push', (evt) => {
    console.log("Got push", evt);
});
self.addEventListener('fetch', (evt) => {
    //console.log("Got fetch event", evt);
});

