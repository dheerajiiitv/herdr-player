import { div, image, PathBuilder, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

export const diameter = 46;
const middle = diameter / 2;
const radius = middle - 1;
const centered = () => h_flex().items_center().justify_center();

export function turnAt(point, center) {
  const dx = point.x - center.x, dy = point.y - center.y;
  if (Math.hypot(dx, dy) < 2) return null;
  return (1 + Math.atan2(dx, -dy) / (2 * Math.PI)) % 1;
}

function progressArc(fraction, color) {
  const end = Math.min(fraction, 1) * 2 * Math.PI;
  const path = PathBuilder.stroke(2).move_to(middle, 1);
  // Use two arcs for a full circle; a single arc with identical endpoints is empty.
  if (end > Math.PI) path.arc_to(radius, radius, 0, false, true, middle, diameter - 1);
  path.arc_to(radius, radius, 0, false, true,
    middle + radius * Math.sin(end), middle - radius * Math.cos(end));
  return window.paint_path(path.build(), color).absolute().inset_0().size(diameter);
}

export function recordFace({ track, cover, spin, fraction, colors: t }) {
  const title = (track?.artist || track?.title || "").trim();
  const face = centered().absolute().inset_0().size(diameter).rounded(middle).overflow_hidden()
    .bg(t.selected).text_color(t.foreground).text_size(11).font_semibold();
  const spinning = spin && track?.playing;
  if (cover) {
    const path = spinning && cover.animated ? cover.animated : cover.still;
    face.child(image(path).id("record-photo").size(diameter).rounded(middle));
  } else if (title && !spinning) {
    face.child(title.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase());
  } else {
    face.child(svg("mods/music-deck/mark.svg").size(19).text_color(t.muted)
      .when(spinning, el => el.spin(16000)));
  }
  return div().relative().size(diameter)
    .child(face)
    .when(fraction > 0, el => el.child(progressArc(fraction, t.ansi6)));
}
