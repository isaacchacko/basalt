-- Basalt in Neovim: a key serves the site the buffer's note is in (basalt dev),
-- and while it's served, what you type is in the page as you type it, saved or
-- not. Each buffer goes to the dev server as you change it (PUT
-- /__basalt/buffer, integrations/buffer.ts), which shows it in place of the
-- note's file; the file is only written by :w, and the page goes back to it
-- when the buffer's written, reloaded or closed.
--
--   require("basalt").setup({ key = "<leader>B" })
--
-- With lazy.nvim, `keys = { "<leader>B" }` in its spec loads it on that key,
-- from anywhere: on a note, the note's site; elsewhere, the one Neovim's in.
--
-- :BasaltToggle serves or stops the site, :BasaltOpen opens the page.

local M = {}

local defaults = {
  -- serves the site the current note is in, or stops it
  key = "<leader>B",
  -- basalt itself; unset, the site's own (its node_modules), else the PATH's, else npm's
  cmd = nil,
  -- how long typing pauses before the page is sent what's typed
  debounce = 150,
}
local opts = defaults

-- sites being served, by their folder: { url, port }
local served = {}
-- buffers the dev server has, and each one's pending send
local sent, timers, busy, again = {}, {}, {}, {}

local function siteOf(buf)
  local file = vim.api.nvim_buf_get_name(buf)
  if file == "" then return nil end
  local found = vim.fs.find("basalt.json", { upward = true, path = vim.fs.dirname(file) })[1]
  return found and vim.fs.dirname(found)
end

-- the site the key is for: the current note's, else the one Neovim was started in (or just under it)
local function here()
  local site = siteOf(0)
  if site then return site end
  local cwd = vim.fn.getcwd()
  local found = vim.fs.find("basalt.json", { upward = true, path = cwd })[1]
    or vim.fs.find(function(name, dir) return name == "basalt.json" and vim.fs.dirname(dir) == cwd end, { path = cwd, limit = 1 })[1]
  return found and vim.fs.dirname(found)
end

local function portOf(site)
  local f = io.open(site .. "/.basalt/astro/.astro/dev.json")
  if not f then return nil end
  local ok, dev = pcall(vim.json.decode, f:read("*a"))
  f:close()
  return ok and dev.port or nil
end

-- how basalt is run for a site: as set, else the version the site has installed, else whatever there is
local function cmdFor(site)
  if opts.cmd then return vim.deepcopy(opts.cmd) end
  local own = site .. "/node_modules/.bin/basalt"
  if vim.fn.executable(own) == 1 then return { own } end
  return vim.fn.executable("basalt") == 1 and { "basalt" } or { "npx", "-y", "@isaacchacko/basalt" }
end

local function say(msg, level) vim.notify("basalt: " .. msg, level or vim.log.levels.INFO) end

-- the buffer's text to the dev server (or, `drop`, the note back to its file); one at a time per buffer, the latest last
local function send(buf, drop)
  local site = siteOf(buf)
  local s = site and served[site]
  if not s then return end
  if busy[buf] then
    again[buf] = drop and "drop" or "put"
    return
  end
  if drop and not sent[buf] then return end
  local body = { file = vim.api.nvim_buf_get_name(buf) }
  if not drop then body.text = table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n") .. ((vim.bo[buf].eol or vim.bo[buf].fixeol) and "\n" or "") end
  busy[buf] = true
  vim.system({
    "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", drop and "DELETE" or "PUT",
    "-H", "content-type: application/json", "-H", "x-basalt-buffer: 1", "--data-binary", "@-",
    ("http://localhost:%d/__basalt/buffer"):format(s.port),
  }, { stdin = vim.json.encode(body), text = true }, function(r)
    vim.schedule(function()
      busy[buf] = nil
      if r.stdout == "200" then sent[buf] = not drop or nil end
      local next = again[buf]
      again[buf] = nil
      if next and vim.api.nvim_buf_is_valid(buf) then send(buf, next == "drop") end
    end)
  end)
end

-- a change: sent once typing pauses; an undo back to what's saved is the file again
local function changed(buf)
  if not served[siteOf(buf) or ""] then return end
  timers[buf] = timers[buf] or vim.uv.new_timer()
  timers[buf]:stop()
  timers[buf]:start(opts.debounce, 0, vim.schedule_wrap(function()
    if vim.api.nvim_buf_is_valid(buf) then send(buf, not vim.bo[buf].modified) end
  end))
end

local function dropped(buf)
  if timers[buf] then
    timers[buf]:stop()
    timers[buf]:close()
    timers[buf] = nil
  end
  send(buf, true)
end

-- every changed note of the site, sent as it is now
local function sendAll(site)
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].modified and siteOf(buf) == site then send(buf) end
  end
end

function M.start(site)
  say("serving " .. vim.fn.fnamemodify(site, ":~") .. "…")
  vim.system(vim.list_extend(cmdFor(site), { "dev", site }), { text = true }, function(r)
    vim.schedule(function()
      local url = (r.stdout or ""):match("https?://[%w%.:]+")
      local port = portOf(site)
      if r.code ~= 0 or not port then return say(vim.trim((r.stderr or "") .. (r.stdout or "")), vim.log.levels.ERROR) end
      served[site] = { url = url or ("http://localhost:" .. port), port = port }
      say("serving at " .. served[site].url)
      sendAll(site)
    end)
  end)
end

function M.stop(site)
  served[site] = nil
  for buf in pairs(sent) do
    if siteOf(buf) == site then sent[buf] = nil end
  end
  vim.system(vim.list_extend(cmdFor(site), { "stop", site }), { text = true }, vim.schedule_wrap(function() say("stopped " .. vim.fn.fnamemodify(site, ":~")) end))
end

function M.toggle()
  local site = here()
  if not site then return say("no basalt.json above this file, or here", vim.log.levels.WARN) end
  if served[site] then M.stop(site) else M.start(site) end
end

function M.open()
  local s = served[here() or ""]
  if not s then return say("not serving this site (" .. opts.key .. ")", vim.log.levels.WARN) end
  vim.ui.open(s.url)
end

function M.setup(user)
  opts = vim.tbl_deep_extend("force", defaults, user or {})
  local group = vim.api.nvim_create_augroup("basalt", { clear = true })
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "TextChangedP" }, {
    group = group,
    pattern = "*.md",
    callback = function(e) changed(e.buf) end,
  })
  -- written, read again from disk, or closed: the page is the file's again
  vim.api.nvim_create_autocmd({ "BufWritePost", "BufReadPost", "BufUnload" }, {
    group = group,
    pattern = "*.md",
    callback = function(e) dropped(e.buf) end,
  })
  -- the server outlives Neovim: what wasn't saved leaves the page with it
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = group,
    callback = function()
      for buf in pairs(sent) do
        local s = served[siteOf(buf) or ""]
        if s then
          vim.system({
            "curl", "-s", "-o", "/dev/null", "-X", "DELETE", "-H", "content-type: application/json", "-H", "x-basalt-buffer: 1",
            "--data-binary", vim.json.encode({ file = vim.api.nvim_buf_get_name(buf) }), ("http://localhost:%d/__basalt/buffer"):format(s.port),
          }):wait(1000)
        end
      end
    end,
  })
  vim.api.nvim_create_user_command("BasaltToggle", M.toggle, { desc = "Serve the site this note is in, or stop it" })
  vim.api.nvim_create_user_command("BasaltOpen", M.open, { desc = "Open the site being served" })
  if opts.key then vim.keymap.set("n", opts.key, M.toggle, { desc = "Basalt: serve this site, or stop" }) end
end

return M
