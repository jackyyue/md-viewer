// 浏览器端。只用原生 DOM，没有构建步骤。
//
// 职责：拉目录树、拉渲染好的 md、维护大纲、把库内链接的点击接管过来。

const libNameEl = document.getElementById("lib-name");
const treeEl = document.getElementById("tree");
const docEl = document.getElementById("doc");
const outlineEl = document.getElementById("outline");
const outlineWrap = document.getElementById("outline-wrap");
const contentEl = document.getElementById("content");

let libraryName = "md-viewer";
let currentRel = null;

async function getJson(url) {
  const response = await fetch(url);
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error(`服务返回了非 JSON 内容（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}

function showError(message) {
  docEl.textContent = "";
  const box = document.createElement("div");
  box.className = "error-box";
  box.textContent = message;
  docEl.appendChild(box);
}

// ---- 目录树 ----

function buildTree(nodes) {
  const list = document.createElement("ul");

  for (const node of nodes) {
    const item = document.createElement("li");

    if (node.type === "dir") {
      item.className = "dir";
      item.dataset.rel = node.rel;

      const row = document.createElement("div");
      row.className = "row dir-row";

      const twisty = document.createElement("span");
      twisty.className = "twisty";
      twisty.textContent = "▸";

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = node.name;

      row.append(twisty, name);
      row.addEventListener("click", () => {
        const open = item.classList.toggle("open");
        twisty.textContent = open ? "▾" : "▸";
      });

      item.append(row, buildTree(node.children));
    } else {
      item.className = "file";

      const row = document.createElement("div");
      row.className = "row file-row";
      row.dataset.rel = node.rel;

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = node.name;

      row.appendChild(name);
      row.addEventListener("click", () => {
        void openFile(node.rel);
      });

      item.appendChild(row);
    }

    list.appendChild(item);
  }

  return list;
}

/** 打开某篇时，把它所在的每一层目录展开。 */
function expandAncestors(rel) {
  const parts = rel.split("/");
  parts.pop();
  let prefix = "";
  for (const part of parts) {
    prefix = prefix === "" ? part : `${prefix}/${part}`;
    const dir = treeEl.querySelector(`li.dir[data-rel="${CSS.escape(prefix)}"]`);
    if (dir !== null) {
      dir.classList.add("open");
      const twisty = dir.querySelector(":scope > .row .twisty");
      if (twisty !== null) twisty.textContent = "▾";
    }
  }
}

function markCurrent(rel) {
  for (const row of treeEl.querySelectorAll(".file-row.current")) {
    row.classList.remove("current");
  }
  const row = treeEl.querySelector(`.file-row[data-rel="${CSS.escape(rel)}"]`);
  if (row !== null) {
    row.classList.add("current");
    row.scrollIntoView({ block: "nearest" });
  }
}

// ---- 大纲 ----

function renderOutline(outline) {
  outlineEl.textContent = "";
  const items = outline.filter((entry) => entry.level <= 3);

  if (items.length === 0) {
    outlineWrap.hidden = true;
    return;
  }

  outlineWrap.hidden = false;
  for (const entry of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `outline-item lv${entry.level}`;
    button.textContent = entry.text;
    button.addEventListener("click", () => {
      document.getElementById(entry.id)?.scrollIntoView({ block: "start" });
    });
    outlineEl.appendChild(button);
  }
}

// ---- 打开文件 ----

async function openFile(rel) {
  currentRel = rel;
  markCurrent(rel);
  expandAncestors(rel);

  try {
    const data = await getJson(`/api/file?p=${encodeURIComponent(rel)}`);
    docEl.innerHTML = data.html;
    renderOutline(data.outline);
    contentEl.scrollTop = 0;
    document.title = `${rel} — ${libraryName}`;
  } catch (error) {
    renderOutline([]);
    showError(`打不开 ${rel}\n${error.message}`);
  }
}

// 库内链接的点击由前端接管，不走浏览器跳转
docEl.addEventListener("click", (event) => {
  const link = event.target.closest("a.md-link");
  if (link === null) return;
  event.preventDefault();
  void openFile(link.dataset.rel);
});

// ---- 启动 ----

async function boot() {
  try {
    const data = await getJson("/api/tree");
    libraryName = data.name;
    libNameEl.textContent = data.name;
    document.title = libraryName;

    treeEl.textContent = "";
    treeEl.appendChild(buildTree(data.tree));

    const first = treeEl.querySelector(".file-row");
    if (first === null) {
      docEl.textContent = "这个文件夹里没有 .md 文件。";
      return;
    }
    await openFile(first.dataset.rel);
  } catch (error) {
    libNameEl.textContent = "读取失败";
    showError(error.message);
  }
}

void boot();
