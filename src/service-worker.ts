/// <reference no-default-lib="true"/>
/// <reference lib="es6" />
/// <reference lib="webworker" />
declare var self: ServiceWorkerGlobalScope;

import {
  AUDIO_CACHE_NAME,
  CacheMessageKind,
  CacheMessage,
  AUDIO_CACHE_LIMIT,
} from "./cache/cs-cache";
import {API_CACHE_NAME, APP_CACHE_PREFIX} from "./types/constants";
import { removeQuery, splitPath } from "./util";
import {
  AudioCache,
  NetworkFirstCache,
} from "./util/sw";
import { APP_COMMIT, isDevelopment, ENVIRONMENT } from "./util/version";

function broadcastMessage(msg: CacheMessage) {
  return self.clients.matchAll({includeUncontrolled: true}).then((clients) => {
    for (const c of clients) {
      console.debug(`Sending ${msg} to client ${c.type}::${c.id}`);
      c.postMessage(msg);
    }
  });
}

let globalPathPrefix: string = (() => {
  const base = location.pathname;
  const folder = splitPath(base).folder;
  if (folder) {
    return folder + "/";
  } else {
    return "/";
  }
})();

const staticResources = [
  globalPathPrefix,
  "index.html",
  "global.css",
  "favicon.png",
  "bundle.css",
  "bundle.js",
  "app.webmanifest",
  "static/will_sleep_soon.mp3",
  "static/extended.mp3",
];

const cacheName = APP_CACHE_PREFIX + APP_COMMIT;
const audioCache = AUDIO_CACHE_NAME;
const apiCache = API_CACHE_NAME;

self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => {
        return cache.addAll(isDevelopment ? ["favicon.png"] : staticResources);
      })
      .then(() => {
        console.log(
          `SW Installation successful (dev ${isDevelopment} ) on path ${location.pathname}`
        );
        return self.skipWaiting(); // forces to immediately replace old SW
      })
  );
});

self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches
      .keys()
      .then((keyList) => {
        return Promise.all(
          keyList.map((key) => {
            if (key.startsWith("static-") && key != cacheName) {
              return caches.delete(key);
            } 
            // else if (key == apiCache) {
            //   return caches.delete(key);
            // }
          })
        );
      })
      .then(() => {
        console.log("SW Activation successful");
        return self.clients.claim(); // and forces immediately to take over current page
      })
  );
});

const audioCacheHandler = new AudioCache(audioCache, AUDIO_CACHE_LIMIT, broadcastMessage);
const apiCacheHandler = new NetworkFirstCache(apiCache);

self.addEventListener("message", (evt) => {
  const msg: CacheMessage = evt.data;
  if (msg.kind === CacheMessageKind.Prefetch) {
    audioCacheHandler.handlePrefetch(evt);
  } else if (msg.kind === CacheMessageKind.AbortLoads) {
    audioCacheHandler.abort(msg.data.pathPrefix, msg.data.keepDirect);
  } else if (msg.kind === CacheMessageKind.Ping) {
    console.debug("Got PING from client");
    evt.source.postMessage({
      kind: CacheMessageKind.Pong,
      data: {
        pendingAudio: audioCacheHandler.getQueue()
      }
    })
  }
});

self.addEventListener("push", (evt) => {
  console.log("Got push message", evt.data.text());
});

const AUDIO_REG_EXP: RegExp = new RegExp(`^${globalPathPrefix}\\d+/audio/`);
const API_REG_EXP: RegExp = new RegExp(`^${globalPathPrefix}(\\d+/)?(folder|collections|transcodings)/?`);

self.addEventListener("fetch", (evt: FetchEvent) => {
  const parsedUrl = new URL(evt.request.url);
  if (AUDIO_REG_EXP.test(parsedUrl.pathname)) {
    console.debug("AUDIO FILE request: ", decodeURI(parsedUrl.pathname));
    // we are not intercepting requests with seek query
    if (parsedUrl.searchParams.get("seek")) return;
    audioCacheHandler.handleRequest(evt);
    
  } else if (API_REG_EXP.test(parsedUrl.pathname)) {
    console.debug("API request "+ parsedUrl.pathname);
    apiCacheHandler.handleRequest(evt);
      
  } else {
    console.log(`Checking ${parsedUrl.pathname} against ${API_REG_EXP} result ${API_REG_EXP.test(parsedUrl.pathname)}`)
    evt.respondWith(
      caches.open(cacheName).then((cache) =>
        cache.match(evt.request).then((response) => {
          console.log(
            `OTHER request: ${evt.request.url}`,
            evt.request,
            response
          );
          return response || fetch(evt.request);
        })
      )
    );
  }
});
