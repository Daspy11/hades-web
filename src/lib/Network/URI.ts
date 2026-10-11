/**
 * The part of Haskell's `Network.URI` used by HADES: recognising URI references (RFC 3986).
 */

const uriRegex: RegExp = (() => {
  const unreserved = "A-Za-z0-9\\-._~";
  const subDelims = "!$&'()*+,;=";
  const pct = "%[0-9A-Fa-f]{2}";
  const pchar = `(?:[${unreserved}${subDelims}:@]|${pct})`;
  const segment = `${pchar}*`;
  const segmentNz = `${pchar}+`;
  const segmentNzNc = `(?:[${unreserved}${subDelims}@]|${pct})+`;
  const queryOrFragment = `(?:${pchar}|[/?])*`;
  const scheme = "[A-Za-z][A-Za-z0-9+\\-.]*";
  const userinfo = `(?:[${unreserved}${subDelims}:]|${pct})*`;
  const decOctet = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
  const ipv4 = `${decOctet}\\.${decOctet}\\.${decOctet}\\.${decOctet}`;
  const h16 = "[0-9A-Fa-f]{1,4}";
  const ls32 = `(?:${h16}:${h16}|${ipv4})`;
  const pre = (n: number) => (n < 0 ? "" : `(?:(?:${h16}:){0,${n}}${h16})?`);
  const ipv6 = "(?:" + [
    `(?:${h16}:){6}${ls32}`,
    `::(?:${h16}:){5}${ls32}`,
    `${pre(0)}::(?:${h16}:){4}${ls32}`,
    `${pre(1)}::(?:${h16}:){3}${ls32}`,
    `${pre(2)}::(?:${h16}:){2}${ls32}`,
    `${pre(3)}::${h16}:${ls32}`,
    `${pre(4)}::${ls32}`,
    `${pre(5)}::${h16}`,
    `${pre(6)}::`,
  ].join("|") + ")";
  const ipvFuture = `v[0-9A-Fa-f]+\\.[${unreserved}${subDelims}:]+`;
  const ipLiteral = `\\[(?:${ipv6}|${ipvFuture})\\]`;
  const regName = `(?:[${unreserved}${subDelims}]|${pct})*`;
  const host = `(?:${ipLiteral}|${regName})`;
  const authority = `(?:${userinfo}@)?${host}(?::[0-9]*)?`;
  const pathAbempty = `(?:/${segment})*`;
  const pathAbsolute = `/(?:${segmentNz}(?:/${segment})*)?`;
  const pathRootless = `${segmentNz}(?:/${segment})*`;
  const pathNoscheme = `${segmentNzNc}(?:/${segment})*`;
  const hierPart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathRootless}|)`;
  const relativePart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathNoscheme}|)`;
  const tail = `(?:\\?${queryOrFragment})?(?:#${queryOrFragment})?`;
  const uri = `${scheme}:${hierPart}${tail}`;
  const relativeRef = `${relativePart}${tail}`;
  return new RegExp(`^(?:${uri}|${relativeRef})$`);
})();

/** Is the string an absolute URI (RFC 3986 "URI") or a relative reference ("relative-ref")? */
export function isURIReference(s: string): boolean {
  return uriRegex.test(s);
}

/** Is the string an absolute URI with an optional fragment (RFC 3986 "URI")? */
export function isURI(s: string): boolean {
  return isURIReference(s) && /^[A-Za-z][A-Za-z0-9+\-.]*:/.test(s);
}
