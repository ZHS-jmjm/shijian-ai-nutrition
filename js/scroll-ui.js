/* 全站页面区块导航：跟随原生滚动并支持键盘跳转。 */
(() => {
  const wrap = document.getElementById("pageScroll");
  const dots = document.getElementById("dots");
  if (!wrap || !dots) return;

  const blocks = [...wrap.querySelectorAll(".snap-block")];
  if (!blocks.length) return;

  const buttons = blocks.map((block, index) => {
    const button = document.createElement("button");
    button.className = "dot";
    button.type = "button";
    button.title = block.dataset.blockName || "区块 " + (index + 1);
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => {
      setActive(index);
      block.scrollIntoView({ block: "start" });
    });
    dots.appendChild(button);
    return button;
  });

  let activeIndex = -1;
  function setActive(index) {
    if (index === activeIndex) return;
    if (activeIndex >= 0) {
      buttons[activeIndex].classList.remove("active");
      buttons[activeIndex].removeAttribute("aria-current");
    }
    buttons[index].classList.add("active");
    buttons[index].setAttribute("aria-current", "location");
    activeIndex = index;
  }

  function updateActive() {
    const top = wrap.scrollTop;
    if (top < 1) {
      setActive(0);
      return;
    }
    if (top + wrap.clientHeight >= wrap.scrollHeight - 1) {
      setActive(blocks.length - 1);
      return;
    }
    const navOffset = Number.parseFloat(getComputedStyle(wrap).scrollPaddingTop) || 0;
    const readingLine = top + navOffset + 16;
    const nextIndex = blocks.findIndex((block) => block.offsetTop > readingLine);
    setActive(nextIndex < 0 ? blocks.length - 1 : Math.max(0, nextIndex - 1));
  }

  let frame = 0;
  function updateOnFrame() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      updateActive();
    });
  }

  wrap.addEventListener("scroll", updateOnFrame, { passive: true });
  window.addEventListener("resize", updateOnFrame);
  updateActive();

  // 在窄屏横向导航中，让当前入口从一开始就位于可视范围内。
  const currentLink = document.querySelector('.nav-links [aria-current="page"]');
  if (currentLink) {
    const nav = currentLink.parentElement;
    const overflow = currentLink.getBoundingClientRect().right - nav.getBoundingClientRect().right;
    if (overflow > 0) nav.scrollLeft += Math.ceil(overflow);
  }
})();
