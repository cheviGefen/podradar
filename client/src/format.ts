// 18:32:14, in the viewer's time zone
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// 2.6 s
export function seconds(value: number): string {
  return `${value.toFixed(1)} s`;
}
