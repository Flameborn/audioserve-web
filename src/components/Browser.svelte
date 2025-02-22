<script lang="ts">
  import { getContext, onDestroy, onMount } from "svelte";
  import type { Unsubscriber } from "svelte/store";
  import { Cache, CacheEvent, EventType } from "../cache";
  import ContinuePlay from "svelte-material-icons/PlayCircleOutline.svelte";
  import SortNameIcon from "svelte-material-icons/SortAlphabeticalAscending.svelte";
  import SortTimeIcon from "svelte-material-icons/SortClockAscendingOutline.svelte";
  import DownloadFolderIcon from "svelte-material-icons/BriefcaseDownloadOutline.svelte";
  import ClockIcon from "svelte-material-icons/ClockOutline.svelte";

  import type { AudioFile, PositionShort, Subfolder } from "../client";
  import {
    apiConfig,
    colApi,
    collections,
    currentFolder,
    group,
    isAuthenticated,
    playItem,
    playList,
    selectedCollection,
  } from "../state/stores";
  import { FolderType, NavigateTarget, StorageKeys } from "../types/enums";
  import { PlayItem } from "../types/play-item";
  import type { AudioFileExt } from "../types/types";
  import { formatTime } from "../util/date";
  import {
    nonEmpty,
    sorted,
    splitExtInName,
    splitPath,
    splitUrl,
  } from "../util";
  import FileItem from "./FileItem.svelte";
  import FolderItem from "./FolderItem.svelte";
  import Description from "./Description.svelte";
  import Cover from "./Cover.svelte";
  import type { HistoryRecord, HistoryWrapper } from "../util/history";
  import { getLocationPath } from "../util/browser";
  import { Debouncer } from "../util/events";
  import Badge from "./Badge.svelte";
  import { Scroller } from "../util/dom";

  const cache: Cache = getContext("cache");
  const history: HistoryWrapper = getContext("history");

  export let container: HTMLDivElement;
  export let infoOpen = false;
  export const navigate = (where: NavigateTarget) => {
    if (!folderIsPlaying()) {
      $selectedCollection = $playList.collection;
      $currentFolder = { value: $playList.folder, type: FolderType.REGULAR };
    } else if (where === NavigateTarget.PLAY_ITEM) {
      const elem: HTMLElement = document.querySelector("div.item.active");
      if (elem != null) {
        const scroller = new Scroller(container);
        scroller.scrollToView(elem);
      }
    }
  };

  let subfolders: Subfolder[] = [];
  let files: AudioFileExt[] = [];
  export const getFiles = () => files;
  let folderPath: string | undefined;
  let searchQuery: string | undefined;
  let folderTime: number;
  let folderTags: object = null;
  let sharedPosition: PositionShort | null;
  let sharePositionDisplayName: string;

  let descriptionPath: string;
  let coverPath: string;

  let sortTime = false;
  const toggleSubfoldersSort = () => {
    sortTime = !sortTime;
    subfolders = sortSubfolders(subfolders);
  };

  function sortSubfolders(subs: Subfolder[]) {
    return subs.sort((a, b) => {
      if (sortTime) {
        return a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0;
      } else {
        return a.name > b.name ? 1 : a.name < b.name ? -1 : 0;
      }
    });
  }

  async function searchFor(query: string) {
    try {
      const result = await $colApi.colIdSearchGet({
        colId: $selectedCollection,
        q: query,
        group: $group,
      });

      subfolders = result.subfolders;
      files = [];

      searchQuery = query;

      // Other properties are not relevant and should be reset
      sharedPosition = undefined;
      folderPath = undefined;
      folderTime = undefined;
      folderTags = undefined;
      descriptionPath = undefined;
      coverPath = undefined;
    } catch (resp) {
      console.error("Cannot search", resp);
      if (resp.status === 401) {
        $isAuthenticated = false;
      } else {
        window.alert("Failed to search");
        if (folderPath) {
          $currentFolder = { type: FolderType.REGULAR, value: folderPath };
        }
      }
    }
  }

  async function loadFolder(folder: string) {
    try {
      const audioFolder = await $colApi.colIdFolderPathGet({
        colId: $selectedCollection,
        path: folder,
        group: $group || undefined,
      });
      const cachedPaths = await cache?.getCachedPaths(
        $selectedCollection,
        folder
      );
      console.debug("Cached files for this folder", cachedPaths);

      files =
        cachedPaths && cachedPaths.length > 0
          ? audioFolder.files!.map((file: AudioFileExt) => {
              if (cachedPaths.indexOf(file.path) >= 0) {
                file.cached = true;
              }
              return file;
            })
          : audioFolder.files!;
      subfolders = sortTime
        ? sortSubfolders(audioFolder.subfolders!)
        : audioFolder.subfolders!;
      localStorage.setItem(StorageKeys.LAST_FOLDER, folder);
      sharedPosition = audioFolder.position;
      sharePositionDisplayName = null;
      if (sharedPosition) {
        files.forEach((f) => {
          if (f.path === sharedPosition.path) {
            sharePositionDisplayName = splitExtInName(f).baseName;
          }
        });
      }

      folderTime = audioFolder.totalTime;
      folderTags = audioFolder.tags;
      descriptionPath = audioFolder.description?.path;
      coverPath = audioFolder.cover?.path;

      // restore last played file, if possible
      if (!$playItem && folderPath === undefined) {
        const prevFile = localStorage.getItem(StorageKeys.LAST_FILE);
        if (prevFile) {
          console.debug(
            `Can try to play ${prevFile} in folder ${$currentFolder} in collection ${$selectedCollection}`
          );
          const position = files.findIndex((f) => f.path === prevFile);
          if (position >= 0) {
            let time: number | undefined;
            try {
              time = parseFloat(
                localStorage.getItem(StorageKeys.LAST_POSITION)
              );
            } catch (e) {
              console.warn("Invalid last position", e);
            }
            startPlaying(position, false, time)();
          }
        }
      }

      folderPath = folder;
    } catch (resp) {
      console.error("Cannot load folder", resp);
      if (resp.status === 404) {
        $currentFolder = { value: "", type: FolderType.REGULAR };
      } else if (resp.status === 401) {
        $isAuthenticated = false;
      } else {
        window.alert("Failed to load folder, staying on current");
        if (folderPath) {
          $currentFolder = { type: FolderType.REGULAR, value: folderPath };
        }
      }
    } finally {
      searchQuery = undefined;
    }
  }

  export function constructHistoryState(scrollTo?: number): HistoryRecord {
    if (searchQuery != null) {
      return {
        folderType: FolderType.SEARCH,
        value: searchQuery,
        collection: $selectedCollection,
        scrollTo,
      };
    } else if (folderPath != null) {
      return {
        folderType: FolderType.REGULAR,
        value: folderPath,
        collection: $selectedCollection,
        scrollTo,
      };
    }
  }

  function navigateTo(folder: string) {
    return () => {
      $currentFolder = { value: folder, type: FolderType.REGULAR };
    };
  }

  function playSharedPosition() {
    const idx = files.findIndex((f) => f.path === sharedPosition.path);
    if (idx >= 0) {
      startPlaying(idx, true, sharedPosition.position)();
    }
  }

  function startPlaying(position: number, startPlay = true, time?: number) {
    return () => {
      const file = files[position];
      const item = new PlayItem({
        file,
        position,
        startPlay,
        time,
      });
      console.debug("Action to start to play: " + item.url);
      $playList = {
        files,
        collection: $selectedCollection,
        folder: $currentFolder.value,
        totalTime: folderTime,
      };
      $playItem = item;
    };
  }

  const unsubsribe: Unsubscriber[] = [];

  unsubsribe.push(
    selectedCollection.subscribe((col) => {
      if (col != undefined) {
        if (folderPath === undefined) {
          // restore last path from localStorage
          $currentFolder = {
            value: localStorage.getItem(StorageKeys.LAST_FOLDER) || "",
            type: FolderType.REGULAR,
          };
        } else {
          // go to root of other collection
          $currentFolder = { value: "", type: FolderType.REGULAR };
          if (folderPath === "") {
            // TODO: fix it by having currentFolder as object
            // have to enforce reload
            loadFolder("");
          }
        }
        localStorage.setItem(
          StorageKeys.LAST_COLLECTION,
          $selectedCollection.toString()
        );
      }
    })
  );

  function folderIsPlaying(): boolean {
    return (
      $playList &&
      $playList.collection === $selectedCollection &&
      $playList.folder === folderPath
    );
  }

  $: if ($currentFolder != undefined) {
    let done: Promise<void>;
    const scrollTo = $currentFolder.scrollTo;
    if ($currentFolder.type === FolderType.REGULAR) {
      done = loadFolder($currentFolder.value);
    } else if ($currentFolder.type === FolderType.SEARCH) {
      done = searchFor($currentFolder.value);
    }

    done.then(() => {
      history.add(constructHistoryState());
      if (!folderIsPlaying()) {
        // Do not scroll to history postion if current folder is playing
        // console.debug("History scroll to " + scrollTo);
        container.scrollTo({ top: scrollTo || 0 });
      }
    });
  }

  const globalPathPrefix = getLocationPath();

  function handleCacheEvent(evt: CacheEvent) {
    const item = evt.item;
    if (item) {
      const cached = evt.kind === EventType.FileCached;
      console.debug("File cached", item);
      const { collection, path } = splitUrl(item.originalUrl, globalPathPrefix);

      // update folder
      if (collection === $selectedCollection) {
        const position = files.findIndex((f) => f.path == path);
        if (position >= 0) {
          let f = files[position];
          f.cached = cached;
          files[position] = f;
        }
      }
      // update playlist
      if ($playList) {
        const { folder, file } = splitPath(path);
        if ($playList.collection == collection && $playList.folder == folder) {
          playList.update((pl) => {
            const position = pl.files.findIndex((f) => f.path == path);
            if (position >= 0) {
              pl.files[position].cached = cached;
            }
            return pl;
          });
        }
      }
    }
  }

  cache?.addListener(handleCacheEvent);

  let scrollDebouncer = new Debouncer<void>(() => {
    history.update(constructHistoryState(container.scrollTop));
  }, 250);

  const updateScroll = () => scrollDebouncer.debounce();
  $: container?.addEventListener("scroll", updateScroll);

  onMount(async () => {});
  onDestroy(() => {
    unsubsribe.forEach((u) => u());
    cache?.removeListener(handleCacheEvent);
    container.removeEventListener("scroll", updateScroll);
  });

  function generateDownloadPath(): string {
    return (
      $apiConfig.basePath +
      `/${$selectedCollection}/download/${encodeURI(folderPath)}`
    );
  }
</script>

<div id="browser">
  <div class="main-browser-panel">
    {#if subfolders.length > 0}
      <details open>
        <summary
          >Subfolders
          <Badge value={subfolders.length} />
          <span
            class="summary-icons"
            on:click|stopPropagation|preventDefault={toggleSubfoldersSort}
          >
            {#if sortTime}
              <SortTimeIcon />
            {:else}
              <SortNameIcon />
            {/if}
          </span>
        </summary>
        <ul>
          {#each subfolders as fld}
            <li on:click={navigateTo(fld.path)}>
              <FolderItem
                subfolder={fld}
                extended={$currentFolder.type != FolderType.REGULAR}
                finished={fld.finished}
              />
            </li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if files.length > 0}
      <details open>
        <summary
          >Files
          <Badge value={files.length} />
          <span class="files-duration"
            ><ClockIcon />
            <span>{formatTime(folderTime)}</span></span
          >
          {#if $collections && $collections.folderDownload}
            <a href={generateDownloadPath()} target="_self"
              ><span class="summary-icons"><DownloadFolderIcon /></span></a
            >
          {/if}
        </summary>
        <ul>
          {#each files as file, pos}
            <li on:click={startPlaying(pos, true, 0)}>
              <FileItem {file} position={pos} {container} />
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
  {#if $currentFolder && $currentFolder.type === FolderType.REGULAR}
    <div class="browser-sidebar">
      {#if sharedPosition}
        <div class="last-position" id="last-remote-position">
          <button on:click={playSharedPosition}
            ><ContinuePlay size="2rem" />
            {sharePositionDisplayName} at {formatTime(
              sharedPosition.position
            )}</button
          >
        </div>
      {/if}
      {#if coverPath || descriptionPath || nonEmpty(folderTags)}
        <details bind:open={infoOpen}>
          <summary>Info</summary>
          {#if coverPath}
            <div id="folder-cover">
              <Cover {coverPath} />
            </div>
          {/if}
          {#if nonEmpty(folderTags)}
            <div id="folder-tags">
              <table role="grid">
                <tbody>
                  {#each sorted(Object.keys(folderTags)) as k}
                    <tr>
                      <th>{k}</th>
                      <td>{folderTags[k]}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
          {#if descriptionPath}
            <div id="folder-description">
              <Description {descriptionPath} />
            </div>
          {/if}
        </details>
      {/if}
    </div>
  {/if}
</div>

<style>
  #folder-tags {
    margin-top: 1rem;
  }

  .files-duration {
    font-size: 80%;
    display: inline-block;
    font-weight: normal;
    vertical-align: text-bottom;
  }
  .summary-icons {
    color: var(--primary);
  }
  .browser-sidebar button {
    overflow: hidden;
  }
  #browser {
    display: flex;
    flex-wrap: nowrap;
    flex-direction: row;
  }

  .main-browser-panel {
    width: 100%;
    margin-right: 3em;
  }

  .browser-sidebar {
    width: 66%;
    padding-right: 1rem;
  }

  @media (max-width: 770px) {
    #browser {
      flex-direction: column-reverse;
    }
    .browser-sidebar {
      width: 100%;
      padding-right: 0;
    }
  }
  summary {
    font-weight: bold;
    font-size: 1.5rem;
    line-height: 1.5rem;
  }
  ul {
    padding-left: 0;
  }
  ul li {
    list-style-type: none;
    cursor: pointer;
    border-bottom: 1px solid var(--accordion-border-color);
  }

  ul li:hover {
    color: var(--primary) !important;
  }
</style>
