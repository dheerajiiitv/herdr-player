// Transport icons from cybertron288/herdr-mods (see LICENSE-upstream).
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { checking, closeOverlay, exec, notify, props, run, setShared, shared, theme, window as appWindow, nextCommand } from "herdr";

import { readTrack, identity, cacheCover, findProgram } from "./media.js";
import { recordFace, turnAt, diameter } from "./ring.js";
const SAVED = "music-deck.playlists";
const MUSIC = "https://music.youtube.com/";
const icon = (name, size) => svg("mods/music-deck/" + name + ".svg").size(size).flex_none();
const clock = seconds => {
  const n = Math.floor(Math.max(0, seconds || 0));
  return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
};
const label = (text, size, color) => div().min_w(0).truncate().text_size(size).text_color(color).child(text);
const saved = () => shared(SAVED) || [];
function playlistId(value) {
  const match = /^https:\/\/(?:(?:music|www)\.)?youtube\.com\/(?:playlist|watch)\?([^#\s]+)/i.exec(value.trim());
  return match?.[1].split("&").map(pair => /^list=([a-zA-Z0-9_-]{1,200})$/.exec(pair)).find(Boolean)?.[1] || null;
}
function sourceName(s) {
  const id = s?.parentApplicationBundleIdentifier || s?.bundleIdentifier || "";
  const names = { "com.google.Chrome": "Chrome", "company.thebrowser.dia": "Dia", "com.apple.Safari": "Safari", "com.spotify.client": "Spotify", "com.apple.Music": "Music", "company.thebrowser.Browser": "Arc" };
  return names[id] || id.split(".").pop() || "macOS";
}
function action(id, body, tip, onClick, primary = false) {
  const t = theme();
  return h_flex().id(id).min_w(26).h(26).px(5).rounded(6).justify_center().items_center()
    .text_color(primary ? t.solid_foreground : t.muted).when(primary, b => b.bg(t.solid))
    .cursor_pointer().hover(b => primary ? b.opacity(0.82) : b.bg(t.hover).text_color(t.foreground))
    .tooltip(tip).on_click(onClick).child(body);
}
export default class MusicDeck extends View {
  init(_p, cx) {
    if (props()?.overlay) {
      this.name = InputState.new({ placeholder: "Playlist name" });
      this.link = InputState.new({ placeholder: "Paste a YouTube Music playlist link" });
      this.link.on("submit", (_e, cx) => this.save(cx));
      this.name.on("submit", () => this.link.focus());
      return;
    }
    this.focus = cx.focus_handle();
    this.spin = props()?.spin !== false;
    if (checking()) return;
    cx.spawn(async cx => {
      this.player = await findProgram("media-control");
      this.encoder = this.spin ? await findProgram("ffmpeg") : null;
      this.refresh(cx);
      for (;;) {
        if (await nextCommand() === "focus") {
          this.focus.focus();
          cx.notify();
        }
      }
    });
    cx.timer.every(3500, cx => { if (appWindow()?.visible) this.refresh(cx); });
  }
  refresh(cx) {
    if (this.reading || !this.player) return;
    this.reading = true;
    cx.spawn(async cx => {
      try {
        const track = await readTrack(this.player);
        const key = identity(track);
        if (key !== identity(this.track)) {
          this.cover = null;
          this.retryArtAt = 0;
          this.drag = null;
        }
        this.track = track;
        this.sampledAt = Date.now();
        this.failed = false;
        if (track?.playing && !this.hovered && Date.now() >= (this.nextNoteAt || 0)) this.emitNote(cx);
        if (track && !this.cover && Date.now() >= (this.retryArtAt || 0)) {
          this.retryArtAt = Date.now() + 30000;
          try {
            const full = await readTrack(this.player, true);
            if (identity(full) === key) this.cover = await cacheCover(full, this.encoder);
          } catch { /* Media and transport stay available when artwork is missing. */ }
        }
      } catch {
        this.failed = true;
        this.track = this.cover = this.drag = null;
      } finally {
        this.reading = false;
        cx.notify();
      }
    });
  }
  emitNote(cx) {
    this.nextNoteAt = Date.now() + 6500;
    this.note = "start";
    cx.notify();
    // Only the endpoints cross into JS. GPUI interpolates the flight and fade.
    cx.timer.after(100, cx => { this.note = "rise"; cx.notify(); });
    cx.timer.after(1550, cx => { this.note = null; cx.notify(); });
  }
  execute(cmd, args, cx, then) {
    cx.spawn(async cx => {
      try {
        const r = await exec(cmd, args, { timeout: 5000 });
        if (r.code) throw Error(r.stderr.trim() || "Command failed");
        then?.(cx);
      } catch (e) { notify({ title: "Music", body: String(e), level: "error" }); }
    });
  }
  open(url, cx) {
    this.execute("/usr/bin/open", ["-b", "com.google.Chrome", url], cx, () => {
      if (props()?.overlay) closeOverlay(props().overlay);
    });
  }
  pick() { run("mod.open", { name: "music-deck" }); }
  save(cx) {
    const id = playlistId(this.link.value()), name = this.name.value().trim();
    if (!id || !name) {
      this.error = id ? "Give this playlist a name." : "Use a YouTube playlist link that includes list=.";
      cx.notify();
      return;
    }
    setShared(SAVED, [...saved().filter(item => item.id !== id), { id, name }]);
    this.adding = false;
    this.error = "";
    this.name.set_value("");
    this.link.set_value("");
    cx.notify();
  }
  picker() {
    const t = theme();
    const row = (key, name, url, remove) => h_flex().items_center().gap(4)
      .child(h_flex().id("pl-" + key).flex_1().min_w(0).h(35).px(8).gap(10).items_center().rounded(6)
        .cursor_pointer().hover(b => b.bg(t.hover)).tooltip("Open in Chrome").on_click((_e, cx) => this.open(url, cx))
        .child(icon("list", 15).text_color(t.ansi6)).child(label(name, 13, t.foreground).flex_1()).child(label("↗", 13, t.dim)))
      .when(remove, b => b.child(action("remove-" + key, "×", "Remove saved link", () => setShared(SAVED, saved().filter(item => item.id !== key)))));
    const field = input => Input.new(input).h(33).px(9).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground).text_size(12);
    return v_flex().w_full().p(16).gap(9).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(9).child(icon("mark", 19).text_color(t.ansi6))
        .child(label("Playlists", 17, t.foreground).font_semibold().flex_1())
        .child(action("close", "×", "Close · Esc", () => closeOverlay(props().overlay))))
      .child(v_flex().max_h(250).id("playlist-scroll").overflow_y_scrollbar()
        .child(row("library", "Your YouTube Music library", MUSIC + "library/playlists", false))
        .child(row("likes", "Liked Music", MUSIC + "playlist?list=LM", false))
        .children(saved().map(item => row(item.id, item.name, MUSIC + "playlist?list=" + item.id, true))))
      .child(div().h(1).bg(t.border))
      .when(!this.adding, b => b.child(action("add", "+  Save a playlist", "Save a playlist link", (_e, cx) => { this.adding = true; cx.notify(); this.name.focus(); })))
      .when(this.adding, b => b.child(v_flex().gap(7).child(field(this.name)).child(field(this.link))
        .when(Boolean(this.error), v => v.child(label(this.error, 11, t.ansi1)))
        .child(h_flex().gap(6).justify_end().child(action("cancel", "Cancel", "Cancel", (_e, cx) => { this.adding = false; this.error = ""; cx.notify(); }))
          .child(action("save", "Save playlist", "Save playlist", (_e, cx) => this.save(cx), true)))));
  }
  control(command, cx) {
    if (!this.track) return this.pick();
    this.execute(this.player, command, cx, cx => cx.timer.after(250, cx => this.refresh(cx)));
  }
  position() {
    if (this.drag) return this.drag.fraction * this.track.duration;
    const s = this.track;
    if (!s) return 0;
    const delta = s.playing ? (Date.now() - this.sampledAt) / 1000 * (s.playbackRate ?? 1) : 0;
    return Math.max(0, Math.min(s.duration || Infinity, (s.elapsedTimeNow ?? s.elapsedTime ?? 0) + delta));
  }
  beginSeek(e, cx) {
    if (!this.track?.duration || !e.bounds) return;
    const { x, y, width, height } = e.bounds;
    const center = { x: x + width / 2, y: y + height / 2 };
    const angle = turnAt(e.position, center);
    if (angle === null) return;
    this.drag = { center, angle, fraction: angle === 0 && this.position() > this.track.duration / 2 ? 1 : angle };
    cx.stop_propagation();
    cx.notify();
  }
  moveSeek(e, cx) {
    if (!this.drag) return;
    if (e.pressed_button !== "left") {
      this.drag = null;
    } else {
      const angle = turnAt(e.position, this.drag.center);
      if (angle === null) return;
      const delta = ((angle - this.drag.angle + 1.5) % 1) - 0.5;
      this.drag.fraction = Math.min(1, Math.max(0, this.drag.fraction + delta));
      this.drag.angle = angle;
    }
    cx.notify();
  }
  finishSeek(cx) {
    if (!this.drag) return;
    const seconds = this.position();
    this.drag = null;
    this.control(["seek", seconds.toFixed(2)], cx);
    cx.notify();
  }
  key(e, cx) {
    const controls = { left: "previous-track", right: "next-track", space: "toggle-play-pause", enter: "toggle-play-pause" };
    const command = controls[e.keystroke];
    if (!command) return;
    cx.stop_propagation();
    if (!e.is_held) this.control([command], cx);
  }
  render() {
    return props()?.overlay ? this.picker() : this.playerRow();
  }
  playerRow() {
    const t = theme(), s = this.track;
    const active = Boolean(this.hovered || this.drag || this.focus.is_focused());
    const position = this.position();
    const meta = s ? [s.title, s.artist, sourceName(s)].filter(Boolean).join(" · ") : "";
    const hint = this.failed ? "Install media-control with Homebrew. Click for playlists." : "Open YouTube Music playlists";
    const toggleHint = s ? (s.playing ? "Pause" : "Play") + " · " + meta : hint;
    const skip = (name, command, tip) => {
      const slotWidth = Math.min(30, Math.max(0, ((this.width ?? 122) - diameter - 8) / 2));
      const slot = h_flex().w(slotWidth).h(30).items_center().justify_center();
      if (slotWidth < 20) return slot;
      return active && s ? slot.child(action(name, icon(name, 13), tip, (_e, cx) => this.control([command], cx))) : slot;
    };
    const face = recordFace({ track: s, cover: this.cover, spin: this.spin,
      fraction: s?.duration ? position / s.duration : 0, colors: t });
    const center = h_flex().id("cover-control").absolute().top(6).left(6).size(diameter - 12).rounded((diameter - 12) / 2)
      .items_center().justify_center().cursor_pointer().tooltip(toggleHint)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.control(["toggle-play-pause"], cx); })
      .when(active, el => el.bg("#121718ba").text_color("#ffffff")
        .child(icon(s ? (s.playing ? "pause" : "play") : "list", 13)));
    const dial = div().id("dial").relative().size(diameter).flex_none()
      .tooltip(s?.duration ? clock(position) + " / " + clock(s.duration) + " · Drag rim to seek" : toggleHint)
      .on_mouse_down("left", (e, cx) => this.beginSeek(e, cx))
      .child(face).child(center)
      .when(Boolean(s?.playing && this.note && !active && (this.width ?? 122) >= 90), el => {
        const rising = this.note === "rise";
        return el.child(div().id("music-note").absolute()
          .top(rising ? -10 : 4).left(rising ? 53 : 40).opacity(rising ? 0 : 0.85)
          .transition("top", { duration: 1300, easing: "ease-out" })
          .transition("left", { duration: 1300, easing: "ease-out" })
          .transition("opacity", { delay: 350, duration: 950 })
          .text_size(12).text_color(t.ansi6).child("♪"));
      });
    return h_flex().id("music-row").size_full().items_center().justify_center().gap(4)
      .bg(t.chrome)
      .on_size_change((size, cx) => {
        if (this.width !== size.width) { this.width = size.width; cx.notify(); }
      })
      .track_focus(this.focus).tab_index(0).on_key_down((e, cx) => this.key(e, cx))
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.pick(); })
      .on_window_mouse_move((e, cx) => this.moveSeek(e, cx))
      .on_window_mouse_up("left", (_e, cx) => this.finishSeek(cx))
      .child(skip("skip-back", "previous-track", "Previous track"))
      .child(dial)
      .child(skip("skip-forward", "next-track", "Next track"));
  }
}
