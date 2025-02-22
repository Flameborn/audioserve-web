<script lang="ts">
  import "@picocss/pico";
  import Login from "./components/Login.svelte";
  import Menu from "./components/Menu.svelte";
  import SearchIcon from "svelte-material-icons/Magnify.svelte";
  import CollectionsIcon from "svelte-material-icons/LibraryShelves.svelte";
  import CloseIcon from "svelte-material-icons/Close.svelte";
  import DownloadIcon from "svelte-material-icons/DownloadMultiple.svelte";
  import SleepIcon from "svelte-material-icons/AlarmSnooze.svelte";
  import SleepCancelIcon from "svelte-material-icons/AlarmOff.svelte";

  import {
    apiConfig,
    colApi,
    isAuthenticated,
    collections,
    transcodings,
    selectedCollection,
    config,
    currentFolder,
    windowSize,
    playItem,
    pendingDownloads,
  } from "./state/stores";
  import { onMount, setContext } from "svelte";
  import { Configuration } from "./client";
  import { deleteCookie } from "./util/auth";
  import CollectionSelector from "./components/CollectionSelector.svelte";
  import Browser from "./components/Browser.svelte";
  import { FolderType, StorageKeys } from "./types/enums";
  import Breadcrumb from "./components/Breadcrumb.svelte";
  import { baseUrl, otherTheme } from "./util/browser";
  import { gainFocus } from "./util/dom";
  import Player from "./components/Player.svelte";
  import type { Cache, PrefetchRequest } from "./cache";
  import { APP_COMMIT, APP_VERSION, isDevelopment } from "./util/version";
  import ConfirmDialog from "./components/ConfirmDialog.svelte";
  import { createAudioContext, loadAudioFile, playBuffer } from "./util/audio";
  import { ShakeDetector } from "./util/movement";
  import ConfigEditor from "./components/ConfigEditor.svelte";
  import { HistoryWrapper } from "./util/history";
  import { API_CACHE_NAME } from "./types/constants";
  import Recent from "./components/Recent.svelte";
  import { PlayItem } from "./types/play-item";

  export let cache: Cache;
  if (cache) {
    cache.maxParallelLoads = $config.maxParallelDownload;
    cache.onQueueSizeChanged((n) => pendingDownloads.set(n));
    setContext("cache", cache);
  }

  const historyChanged = () => {
    showComponent = "browser";
  };
  const history = new HistoryWrapper(historyChanged);
  setContext("history", history);

  const themePreference = localStorage.getItem(StorageKeys.THEME);
  if (themePreference) {
    document.querySelector("html").setAttribute("data-theme", themePreference);
  }

  const API_BASE_URL = baseUrl(isDevelopment);
  apiConfig.set(
    new Configuration({
      basePath: API_BASE_URL,
      credentials: "include",
    })
  );

  let container: HTMLDivElement;
  let browser: Browser;

  async function loadCollections() {
    const cols = await $colApi.collectionsGet();
    console.debug("Got collections list", cols);
    $collections = cols;
    let parsedCollection: number = parseInt(
      localStorage.getItem(StorageKeys.LAST_COLLECTION) || "0"
    );
    if (parsedCollection >= cols.names.length) parsedCollection = 0;
    $selectedCollection = parsedCollection;
    const trans = await $colApi.transcodingsGet();
    console.debug("Got transcodings list", trans);
    $transcodings = trans;
  }

  function actOnMenu(menuEvt) {
    const menuSelection: string = menuEvt.detail;
    console.debug("Menu selected", menuSelection);
    switch (menuSelection) {
      case "logout":
        $isAuthenticated = false;
        deleteCookie();
        break;
      case "switch-theme":
        const theme = otherTheme();
        document.querySelector("html").setAttribute("data-theme", theme);
        localStorage.setItem(StorageKeys.THEME, theme);
        break;
      case "clear-cache":
        Promise.all([
          cache?.clearCache().then(() => {
            cache.cancelPendingLoads("", true);
          }),
          window?.caches.delete(API_CACHE_NAME),
        ])
          .then(() => window.location.reload())
          .catch((e) => console.warn("Error clearing cache " + e));
        break;
      case "show-preferences":
        showComponent = "config";
        break;
      case "about":
        showAboutDialog();
        break;
      case "recent":
        showComponent = "recent";
        break;
      case "download":
        showComponent = "browser";
        downloadCurrentFolder();
    }
  }

  function downloadCurrentFolder() {
    if (!cache || !browser) return;
    const preCaches: PrefetchRequest[] = [];
    const files = browser.getFiles();
    for (let i = 0; i < files.length; i++) {
      const nextFile = files[i];
      if (!nextFile.cached) {
        const item = new PlayItem({
          file: nextFile,
          collection: $selectedCollection,
          position: i,
        });
        preCaches.push({
          url: item.url,
          folderPosition: item.position,
          lowPriority: true,
        });
      }
    }
    if (cache && preCaches.length > 0) {
      console.log(`Try to cache ${preCaches.length} files`);
      cache.cacheAhead(preCaches);
    }
  }

  let searchValue: string;

  function checkSearch(evt: KeyboardEvent) {
    if (evt.key === "Enter" && searchValue.length > 0) {
      $currentFolder = { value: searchValue, type: FolderType.SEARCH };
    }
  }

  let error: string = null;

  onMount(async () => {
    try {
      await loadCollections();
    } catch (e) {
      console.error("Error loading initial lists", e);
      if (e instanceof Response) {
        if (e.status === 401) {
          $isAuthenticated = false;
          // try to load again after authentication
          const unsubsribe = isAuthenticated.subscribe(async (ok) => {
            if (ok) {
              try {
                await loadCollections();
              } catch (e) {
                error = `Fail to load collections after authentication, one reason can be insecure context and API on diffrent origin`;
              }
            }
          });
        } else {
          error = `Unexpected respose from server: ${e.status} ${e.statusText}`;
        }
      } else {
        error = `Cannot contact server: ${e}`;
      }
    }
  });

  $: console.debug("Selected collection is " + $selectedCollection);

  let showSearch = true;
  let showCollectionSelect = true;
  let showLogo = true;
  let smallScreen = false;

  windowSize.subscribe((sz) => {
    if (sz.width <= 770) {
      if (!smallScreen) {
        showSearch = false;
        showCollectionSelect = false;
        showLogo = true;
      }
      smallScreen = true;
    } else {
      showSearch = true;
      showCollectionSelect = true;
      smallScreen = false;
      showLogo = true;
    }
  });

  function toggleCollectionsSelect() {
    if (showCollectionSelect) {
      showCollectionSelect = false;
      showSearch = false;
      showLogo = true;
    } else {
      showCollectionSelect = true;
      showSearch = false;
      showLogo = false;
    }
  }

  function toggleSearch() {
    if (showSearch) {
      showSearch = false;
      showCollectionSelect = false;
      showLogo = true;
    } else {
      showSearch = true;
      showCollectionSelect = false;
      showLogo = false;
    }
  }

  function closeNavInput() {
    showSearch = false;
    showCollectionSelect = false;
    showLogo = true;
  }

  // Preferch Download section

  const DOWNLOAD_DIALOG_ID = "cancel-prefetch-dialog";
  const ABOUT_DIALOG_ID = "about-dialog";

  let cancelPrefetchDialog: ConfirmDialog;

  function showDownloadDialog(evt) {
    cancelPrefetchDialog.toggleModal(evt);
  }

  function cancelAllPrefetch() {
    console.debug("Cancel all prefetch loads");
    cache.cancelPendingLoads("", true, true);
  }

  // About Dialog

  let aboutDialog: ConfirmDialog;

  function showAboutDialog() {
    aboutDialog.toggleModal();
  }

  // Sleep Timer Section

  let sleepTime = 0;
  let sleepTimer: number;
  let player: Player;
  let shakeDetector: ShakeDetector = null;
  const clearShakeDetector = () => {
    if (shakeDetector) {
      shakeDetector.finish();
      shakeDetector = null;
    }
  };

  async function startSleepTimer() {
    const ac = createAudioContext();
    const soundSleep = await loadAudioFile("static/will_sleep_soon.mp3", ac);
    const soundExtended = await loadAudioFile("static/extended.mp3", ac);

    sleepTime = $config.sleepTimerPeriod;
    sleepTimer = window.setInterval(() => {
      sleepTime -= 1;
      if (sleepTime === 1) {
        playBuffer(soundSleep, ac);
        shakeDetector = new ShakeDetector((how) => {
          sleepTime += $config.sleepTimerExtend;
          playBuffer(soundExtended, ac);
          clearShakeDetector();
        });
      } else if (sleepTime === 0) {
        player?.pause();
        window.clearInterval(sleepTimer);
        clearShakeDetector();
      }
    }, 60000);
  }

  function stopSleepTimer() {
    window.clearInterval(sleepTimer);
    clearShakeDetector();
    sleepTime = 0;
  }

  let showComponent: "browser" | "config" | "recent" = "browser";

  selectedCollection.subscribe((_col) => {
    showComponent = "browser";
  });

  currentFolder.subscribe((_folder) => {
    showComponent = "browser";
  });
</script>

<main>
  {#if error}
    <h2>Error!</h2>
    <p>{error}</p>
  {:else if !$isAuthenticated}
    <Login />
  {:else}
    <div class="head">
      <nav class="nav-bar">
        {#if showLogo}
          <ul>
            <li>
              <h4 class="logo">
                <a href="/">
                  {#if smallScreen}
                    as
                  {:else}
                    audioserve
                  {/if}
                </a>
              </h4>
            </li>
          </ul>
        {/if}
        <ul class="right-bar">
          <li class="search-bar-box">
            <div class="search-bar">
              {#if showCollectionSelect}
                <CollectionSelector selected={$selectedCollection} />
                {#if smallScreen}
                  <span on:click={closeNavInput}
                    ><CloseIcon size="1.6rem" /></span
                  >
                {/if}
              {/if}

              {#if showSearch}
                <input
                  type="text"
                  name="search"
                  placeholder="Search"
                  on:keyup={checkSearch}
                  bind:value={searchValue}
                  use:gainFocus
                />
                {#if smallScreen}
                  <span on:click={closeNavInput}
                    ><CloseIcon size="1.6rem" /></span
                  >
                {/if}
              {/if}
            </div>
          </li>
          <li class="icons">
            {#if !showCollectionSelect && !showSearch && smallScreen}
              <span on:click={toggleCollectionsSelect}
                ><CollectionsIcon size="1.5rem" /></span
              >
              <span on:click={toggleSearch}><SearchIcon size="1.5rem" /></span>
            {/if}
            {#if (!showCollectionSelect && !showSearch) || !smallScreen}
              {#if $pendingDownloads > 0}
                <span on:click={showDownloadDialog} class="withText">
                  <DownloadIcon size="1.5rem" />
                  {$pendingDownloads}
                </span>
              {/if}

              {#if sleepTime > 0}
                <span on:click={stopSleepTimer} class="withText">
                  <SleepCancelIcon size="1.5rem" />
                  {sleepTime}
                </span>
              {:else}
                <span on:click={startSleepTimer}>
                  <SleepIcon size="1.5rem" />
                </span>
              {/if}
            {/if}
            <Menu on:menu={actOnMenu} />
          </li>
        </ul>
      </nav>
    </div>

    {#if showComponent == "config"}
      <div class="browser">
        <ConfigEditor
          on:finished={() => {
            showComponent = "browser";
          }}
        />
      </div>
    {:else if showComponent == "recent"}
      <div class="browser">
        <Recent on:close={() => (showComponent = "browser")} />
      </div>
    {:else}
      <Breadcrumb />
      <div class="browser" bind:this={container}>
        <Browser {container} infoOpen={!smallScreen} bind:this={browser} />
      </div>
    {/if}
    {#if $playItem}
      <div class="player">
        <Player
          bind:this={player}
          on:navigate={(evt) => browser?.navigate(evt.detail)}
        />
      </div>
    {/if}
  {/if}
</main>

<ConfirmDialog
  id={DOWNLOAD_DIALOG_ID}
  bind:this={cancelPrefetchDialog}
  confirmAction={cancelAllPrefetch}
>
  <svelte:fragment slot="header">Cancel All Running Loads?</svelte:fragment>
  <svelte:fragment slot="body"
    >Do you want to cancel all currently running loads of audio files?</svelte:fragment
  >
</ConfirmDialog>

<ConfirmDialog id={ABOUT_DIALOG_ID} noConfirm={true} bind:this={aboutDialog}>
  <svelte:fragment slot="header">Audioserve Web Client</svelte:fragment>
  <svelte:fragment slot="body">
    <p>New PWA client built with Svelte and TypeScript</p>
    <p>
      <a href="https://github.com/izderadicka/audioserve-web">Check it's site</a
      >
    </p>
    <p>Version: {APP_VERSION}({APP_COMMIT})</p>
    <p>Server Version: {$collections?.version}</p>
  </svelte:fragment>
</ConfirmDialog>

<style>
  .icons span.withText {
    display: inline-flex;
  }

  .logo {
    margin-bottom: 0;
  }

  .icons {
    display: flex;
  }
  .right-bar {
    flex-grow: 1;
  }

  .search-bar {
    display: flex;
    flex-direction: row;
  }

  .search-bar-box {
    flex-grow: 1;
  }

  .search-bar-box input {
    margin-bottom: 0;
  }
  main {
    padding: 16px;
    display: flex;
    flex-flow: column;
    height: 100%;
  }

  .head {
    flex: 0 1 auto;
  }
  .browser {
    flex: 1 1 auto;
    overflow-y: scroll;
    position: relative;
  }
  .player {
    flex: 0 1 auto;
  }

  @media (max-height: 740px) {
    main {
      padding-top: 4px;
      padding-bottom: 0px;
    }
  }
</style>
