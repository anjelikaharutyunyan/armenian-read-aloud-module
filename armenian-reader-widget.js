(() => {
  "use strict";

  const ignoredContent = [
    "script", "style", "noscript", "button", "input", "select", "textarea",
    "nav", "form", "[hidden]", '[aria-hidden="true"]', "[data-reader-ignore]"
  ].join(",");
  const wordPattern = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;

  function initialize(root) {
    const content = root.querySelector("[data-reader-content]");
    const button = root.querySelector("[data-reader-play]");
    const status = root.querySelector("[data-reader-status]");

    if (!content || !button || !status || !window.ArmenianSpeech?.speak) return;

    const words = [];
    let activeWord = -1;
    let controller = null;
    const highlightsEnabled = root.dataset.highlight !== "false";
    const labels = {
      play: button.dataset.labelPlay || button.textContent.trim() || "Կարդալ էջը",
      stop: button.dataset.labelStop || "Դադարեցնել ընթերցումը",
      loading: button.dataset.statusLoading || "Ներբեռնվում է հայերեն ձայնը…",
      preparing: button.dataset.statusPreparing || "Պատրաստվում է հայերեն ձայնը…",
      error: button.dataset.statusError || "Չհաջողվեց կարդալ էջը։ Խնդրում ենք կրկին փորձել։"
    };

    function prepareHighlights() {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      const textNodes = [];

      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement?.closest(ignoredContent)) textNodes.push(node);
      }

      for (const node of textNodes) {
        const text = node.textContent;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        for (const match of text.matchAll(wordPattern)) {
          if (match.index > lastIndex) fragment.append(text.slice(lastIndex, match.index));
          const span = document.createElement("span");
          span.className = "armenian-reader__word";
          span.textContent = match[0];
          fragment.append(span);
          words.push(span);
          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) fragment.append(text.slice(lastIndex));
        node.replaceWith(fragment);
      }
    }

    function highlightWord(index) {
      if (!highlightsEnabled || activeWord === index) return;
      words[activeWord]?.classList.remove("is-speaking");
      words[index]?.classList.add("is-speaking");
      activeWord = index;
    }

    function getText() {
      const copy = content.cloneNode(true);
      copy.querySelectorAll(ignoredContent).forEach(element => element.remove());
      return (copy.textContent || "").replace(/\s+/gu, " ").trim();
    }

    function setPlaying(playing) {
      button.setAttribute("aria-pressed", String(playing));
      button.textContent = playing ? labels.stop : labels.play;
      button.setAttribute("aria-label", playing ? labels.stop : labels.play);
    }

    function showStatus(message) {
      status.textContent = message;
      status.hidden = !message;
    }

    function stop() {
      controller?.abort();
      controller = null;
      highlightWord(-1);
      setPlaying(false);
    }

    async function play() {
      const text = getText();
      if (!text) return;

      stop();
      const currentController = new AbortController();
      controller = currentController;
      setPlaying(true);
      showStatus(labels.preparing);

      const audio = new Audio();
      window.ArmenianSpeech.unlockAudio(audio);

      try {
        await window.ArmenianSpeech.speak(text, {
          audio,
          signal: currentController.signal,
          onWord: highlightWord,
          onStatus: ({ stage, progress }) => {
            if (currentController.signal.aborted) return;
            if (stage === "loading") {
              showStatus(`${labels.loading} ${Math.round(progress * 100)}%`);
            } else if (stage === "synthesizing") {
              showStatus(labels.preparing);
            } else if (stage === "playing") {
              showStatus("");
            }
          }
        });
      } catch (error) {
        if (error.name !== "AbortError") {
          showStatus(labels.error);
          console.error("Armenian speech playback failed.", error);
        }
      } finally {
        if (controller === currentController) {
          controller = null;
          highlightWord(-1);
          setPlaying(false);
        }
      }
    }

    if (highlightsEnabled) prepareHighlights();
    setPlaying(false);
    button.addEventListener("click", () => {
      if (controller) {
        stop();
        showStatus("");
      } else {
        play();
      }
    });
    window.addEventListener("beforeunload", stop, { once: true });
  }

  document.querySelectorAll("[data-armenian-reader]").forEach(initialize);
})();
