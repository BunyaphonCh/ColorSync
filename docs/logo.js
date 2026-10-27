export function drawPixelLogo() {
  // วาดตัวอักษรแบบพิกเซล ใช้ตกแต่งหัวเว็บเท่านั้น ไม่เกี่ยวกับกติกาเกม
  const glyphs = {
    C: ["01111", "11000", "11000", "11000", "11000", "11000", "01111"],
    O: ["01110", "11011", "11011", "11011", "11011", "11011", "01110"],
    L: ["11000", "11000", "11000", "11000", "11000", "11000", "11111"],
    R: ["11110", "11011", "11011", "11110", "11100", "11010", "11011"],
    S: ["01111", "11000", "11000", "01110", "00011", "00011", "11110"],
    Y: ["11011", "11011", "11011", "01110", "00100", "00100", "00100"],
    N: ["11011", "11011", "11111", "11111", "11111", "11011", "11011"],
  };
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "pixel-heading");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("viewBox", "0 0 53 7");
  svg.setAttribute("aria-hidden", "true");
  [..."COLORSYNC"].forEach((c, i) =>
    glyphs[c].forEach((row, y) =>
      [...row].forEach((v, x) => {
        if (v === "1") {
          const record = document.createElementNS(ns, "rect");
          record.setAttribute("x", i * 6 + x);
          record.setAttribute("y", y);
          record.setAttribute("width", "1");
          record.setAttribute("height", "1");
          record.setAttribute(
            "fill",
            i >= 5 ? "var(--accent)" : "currentColor",
          );
          svg.append(record);
        }
      }),
    ),
  );
  document.getElementById("pixel-title").replaceChildren(svg);
}
