export type PageTheme = "light" | "dark";

type Rgb = [number, number, number];

/** Detect the rendered page surface without reading page content or form values. */
export function detectPageTheme(): PageTheme {
  const root = document.documentElement;
  const body = document.body;
  const rootStyle = getComputedStyle(root);
  const bodyStyle = body ? getComputedStyle(body) : rootStyle;
  const colorScheme = `${rootStyle.colorScheme} ${bodyStyle.colorScheme}`.trim();
  const backgrounds: Array<{ color: Rgb; weight: number }> = [];

  // SPAs often leave body/html transparent and paint the actual shell in a
  // full-viewport container. Sample the viewport so the shell is detected.
  addBackground(bodyStyle.backgroundColor, 1);
  addBackground(rootStyle.backgroundColor, 1);
  if (typeof document.elementsFromPoint === "function" && typeof window !== "undefined") {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const points = [
      [0.03, 0.04, 4], [0.50, 0.04, 3], [0.97, 0.04, 4],
      [0.03, 0.50, 4], [0.50, 0.50, 2], [0.97, 0.50, 4],
      [0.03, 0.96, 4], [0.50, 0.96, 3], [0.97, 0.96, 4],
    ] as const;
    for (const [x, y, weight] of points) {
      const elements = document.elementsFromPoint(width * x, height * y);
      for (const element of elements) {
        const style = getComputedStyle(element);
        if (readOpaqueColor(style.backgroundColor)) {
          addBackground(style.backgroundColor, weight);
          break;
        }
      }
    }
  }
  if (backgrounds.length) {
    const darkWeight = backgrounds.reduce((sum, item) => sum + (luminance(item.color) < 0.42 ? item.weight : 0), 0);
    const lightWeight = backgrounds.reduce((sum, item) => sum + (luminance(item.color) >= 0.42 ? item.weight : 0), 0);
    if (darkWeight !== lightWeight) return darkWeight > lightWeight ? "dark" : "light";
  }

  // Transparent layouts often communicate their theme through the default text colour.
  const text = readOpaqueColor(bodyStyle.color) ?? readOpaqueColor(rootStyle.color);
  if (text && luminance(text) > 0.70) return "dark";
  if (text && luminance(text) < 0.30) return "light";
  if (colorScheme === "dark" || (colorScheme.includes("dark") && !colorScheme.includes("light"))) return "dark";
  return "light";

  function addBackground(value: string, weight: number): void {
    const color = readOpaqueColor(value);
    if (color) backgrounds.push({ color, weight });
  }

  function readOpaqueColor(value: string): Rgb | null {
    const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i);
    if (!match) return null;
    const alpha = match[4] == null ? 1 : (match[4].endsWith("%") ? Number.parseFloat(match[4]) / 100 : Number.parseFloat(match[4]));
    return alpha > 0.9 ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  function luminance([red, green, blue]: Rgb): number {
    const linear = (channel: number): number => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  }
}
