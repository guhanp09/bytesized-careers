/**
 * Serializing structured data into an inline `<script>` tag.
 *
 * `JSON.stringify` produces valid JSON, and valid JSON is not automatically
 * safe inside HTML. An HTML parser stops the script at the first `</script`
 * sequence it sees, wherever it appears — including inside a JSON string. A job
 * title, a company name, or a description carrying `</script><img
 * onerror=...>` therefore ends the data block and begins markup, on a public
 * page, with content a recruiter typed.
 *
 * The characters below are escaped as JSON `\uXXXX` sequences, which every JSON
 * parser reads back as the original character. The document is unchanged for
 * consumers; only the HTML parser's view of it changes.
 *
 * `<` and `>` close the tag. `&` is escaped because an HTML entity inside the
 * block can reconstruct one of them. U+2028 and U+2029 are legal in JSON strings
 * and were historically illegal in JavaScript string literals — a difference
 * that has broken inline parsing before, and costs nothing to remove.
 */
const HTML_UNSAFE = /[<>&\u2028\u2029]/g;

const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * JSON for an inline `application/ld+json` block.
 *
 * Use this for every `dangerouslySetInnerHTML` that carries structured data.
 * There is no safe variant that takes a pre-serialized string, because by then
 * the escaping decision has already been made somewhere else.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(HTML_UNSAFE, (character) => ESCAPES[character] ?? character);
}
