---
title: In Neovim
description: "A key serves the garden, and the page shows what you type before you save."
aliases: [neovim, nvim]
---

Write in Neovim, and the page beside it keeps up with what you type, saved or not. `:w` still writes the file, and nothing else does.

![[neovim.mp4|one key serves the garden, and the page takes each line as it's typed, before it's saved|gif]]

## Install it

With [lazy.nvim](https://lazy.folke.io):

```lua
{ "isaacchacko/basalt", ft = "markdown", keys = { "<leader>B" }, cmd = { "BasaltToggle", "BasaltOpen" }, opts = {} }
```

It needs `curl`, and Basalt itself: the garden's own, when its `package.json` has `@isaacchacko/basalt`, else `basalt` on your PATH, else it runs it from npm.

## Use it

Press `<leader>B`, and the garden is served, as `basalt dev` would: the one the note you're on is in (the nearest `basalt.json` above it), or, from the dashboard or any buffer that isn't a file, the one Neovim was started in, or just under it. Your browser opens on the note's page (the home page, off a note). Open the page, and type.

- **As you type.** A moment after you stop, the page has what you wrote: a paragraph, a highlight, an aside in the margin, a diagram. It swaps in where it is, keeping your scroll.
- **Saving is yours.** The file on disk is only written by `:w`. Write the buffer, read it again with `:e!`, undo back to what's saved, or close it, and the page goes back to the file.
- **Every note you've changed.** Each changed buffer in the garden is shown, and a note that embeds or lists one shows it too.
- `<leader>B` again stops the server. `:BasaltToggle` does the same, and `:BasaltOpen` opens the page again.

## Settings

```lua
opts = {
  key = "<leader>B",   -- serve or stop (false: no key)
  cmd = { "basalt" },  -- how basalt is run (unset: the garden's own)
  debounce = 150,      -- ms of quiet, then it's sent
  open = true,         -- serving opens the note's page
}
```

## Another editor

The plugin is a few lines over two requests to the dev server, so any editor can do the same. Each sends JSON with the `x-basalt-buffer: 1` header, which a web page can't send:

```sh
# the note as its buffer has it
curl -X PUT localhost:4321/__basalt/buffer -H 'content-type: application/json' -H 'x-basalt-buffer: 1' \
  -d '{"file": "notes/tides.md", "text": "---\ntitle: Tides\n---\n\nTyped, not saved.\n"}'

# dropped: the note is its file again
curl -X DELETE localhost:4321/__basalt/buffer -H 'content-type: application/json' -H 'x-basalt-buffer: 1' \
  -d '{"file": "notes/tides.md"}'
```

`file` is the note's path, absolute or from the garden's folder. Either counts as a save for `basalt wait`, so [[agents]] see it land too.
