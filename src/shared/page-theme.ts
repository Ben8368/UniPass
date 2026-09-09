export type PageTheme = "light" | "dark";

/** Detect the rendered page surface without reading page content or form values. */
export function detectPageTheme(): PageTheme {
  const root = document.documentElement;
  const body = document.body;
  const rootStyle = getComputedStyle(root);
  const bodyStyle = body ? getComputedStyle(body) : rootStyle;
  const colorScheme = `${rootStyle.colorScheme} ${bodyStyle.colorScheme}`.trim();
  const background = readOpaqueColor(bodyStyle.backgroundColor) ?? readOpaqueColor(rootStyle.backgroundColor);
  if (background) return luminance(background) < 0.42 ? "dark" : "light";

  // Transparent layouts often communicate their theme through the default text colour.
  const text = readOpaqueColor(bodyStyle.color) ?? readOpaqueColor(rootStyle.color);
  if (text && luminance(text) > 0.70) return "dark";
  if (text && luminance(text) < 0.30) return "light";
  if (colorScheme === "dark" || (colorScheme.includes("dark") && !colorScheme.includes("light"))) return "dark";
  return "light";

  function readOpaqueColor(value: string): [number, number, number] | null {
    const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i);
    if (!match) return null;
    const alpha = match[4] == null ? 1 : (match[4].endsWith("%") ? Number.parseFloat(match[4]) / 100 : Number.parseFloat(match[4]));
    return alpha > 0.9 ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  function luminance([red, green, blue]: [number, number, number]): number {
    const linear = (channel: number): number => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  }
}
