import { describe, it, expect } from "vitest";
import {
  BUILTIN_KEYS,
  MissingVariableError,
  detectVariables,
  escapeHtml,
  findMalformedTags,
  renderEmail,
  renderTemplate,
  resolveFirstName,
  stripHeaderBreaks,
  textToHtml,
  validateVariableMap,
  type EmailTemplate,
  type RenderContext,
  type TemplateVariable,
} from "../../server/domain/template.ts";

const ctx: RenderContext = {
  unsubscribeUrl: "https://mail.example.com/u?t=abc&s=1",
  postalAddress: "1 Main St, Springfield",
  today: "October 25, 2026",
};

function template(overrides: Partial<EmailTemplate>): EmailTemplate {
  return { subject: "Hello", html: "<p>Hi</p>", text: null, variableMap: {}, ...overrides };
}

function variable(name: string, alwaysHasFallback = false): TemplateVariable {
  return { name, fallback: alwaysHasFallback ? "x" : null, alwaysHasFallback, occurrences: 1 };
}

describe("detectVariables", () => {
  it("detects names and fallbacks", () => {
    expect(detectVariables("Hi {{first_name | there}} <{{email}}>")).toEqual([
      { name: "first_name", fallback: "there", alwaysHasFallback: true, occurrences: 1 },
      { name: "email", fallback: null, alwaysHasFallback: false, occurrences: 1 },
    ]);
  });

  it("ignores whitespace and accepts an empty fallback", () => {
    expect(detectVariables("{{  company  }} {{x|}}")).toEqual([
      { name: "company", fallback: null, alwaysHasFallback: false, occurrences: 1 },
      { name: "x", fallback: "", alwaysHasFallback: true, occurrences: 1 },
    ]);
  });

  it("dedupes across texts, keeps the first non-null fallback, and tracks alwaysHasFallback", () => {
    const vars = detectVariables("{{first_name}} {{city|here}}", "<p>{{first_name|friend}} {{city|there}}</p>", "{{first_name|pal}}");
    expect(vars).toEqual([
      { name: "first_name", fallback: "friend", alwaysHasFallback: false, occurrences: 3 },
      { name: "city", fallback: "here", alwaysHasFallback: true, occurrences: 2 },
    ]);
  });

  it("does not detect malformed tags", () => {
    expect(detectVariables("{{ first name }} {{x {{}}")).toEqual([]);
  });
});

describe("findMalformedTags", () => {
  it("reports a tag with a space in the name", () => {
    expect(findMalformedTags("Hi {{ first name }}!")).toEqual([{ index: 3, snippet: "{{ first name }}" }]);
  });

  it("reports an unclosed tag", () => {
    expect(findMalformedTags("Hi {{x")).toEqual([{ index: 3, snippet: "{{x" }]);
  });

  it("reports an empty tag", () => {
    expect(findMalformedTags("a {{}} b")).toEqual([{ index: 2, snippet: "{{}}" }]);
  });

  it("does not run an unclosed snippet into the next tag", () => {
    expect(findMalformedTags("{{x and {{y}}")).toEqual([{ index: 0, snippet: "{{x and " }]);
  });

  it("does not let a fallback swallow another tag opener", () => {
    expect(findMalformedTags("{{x | a{{b}}")).toEqual([{ index: 0, snippet: "{{x | a" }]);
    expect(detectVariables("{{x | a{{b}}").map((v) => v.name)).toEqual(["b"]);
  });

  it("returns nothing for valid tags", () => {
    expect(findMalformedTags("{{a}} {{ b | c }} {{d|}} {{{e}}}")).toEqual([]);
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml("<b>&")).toBe("&lt;b&gt;&amp;");
    expect(escapeHtml(`"it's"`)).toBe("&quot;it&#39;s&quot;");
  });
});

describe("stripHeaderBreaks", () => {
  it("replaces CR, LF, U+2028 and U+2029 with a single space and trims", () => {
    expect(stripHeaderBreaks("Hi\r\nBcc: x@y.com")).toBe("Hi Bcc: x@y.com");
    expect(stripHeaderBreaks("a\u2028b\u2029c\rd\ne")).toBe("a b c d e");
    expect(stripHeaderBreaks("\n padded \n")).toBe("padded");
  });
});

describe("renderTemplate", () => {
  it("escapes values when asked", () => {
    expect(renderTemplate("Hi {{n}}", { n: "<x>" }, { escape: true })).toBe("Hi &lt;x&gt;");
  });

  it("leaves values unescaped otherwise", () => {
    expect(renderTemplate("Hi {{n}}", { n: "<x>" }, { escape: false })).toBe("Hi <x>");
  });

  it("uses the fallback when the value is missing, null or blank", () => {
    expect(renderTemplate("Hi {{n | there}}", {}, { escape: true })).toBe("Hi there");
    expect(renderTemplate("Hi {{n | there}}", { n: null }, { escape: true })).toBe("Hi there");
    expect(renderTemplate("Hi {{n | there}}", { n: "   " }, { escape: true })).toBe("Hi there");
    expect(renderTemplate("Hi{{n|}}!", {}, { escape: true })).toBe("Hi!");
  });

  it("does not escape fallbacks", () => {
    expect(renderTemplate("{{x | Tom &amp; Jerry}}", {}, { escape: true })).toBe("Tom &amp; Jerry");
  });

  it("throws MissingVariableError carrying the variable name", () => {
    let caught: unknown;
    try {
      renderTemplate("Hi {{company}}", {}, { escape: false });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingVariableError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as MissingVariableError).variable).toBe("company");
    expect((caught as MissingVariableError).message).toContain("company");
  });

  it("does not re-expand tags inside values", () => {
    expect(renderTemplate("{{a}}", { a: "{{b}}", b: "secret" }, { escape: false })).toBe("{{b}}");
  });

  it("does not read inherited properties as values", () => {
    expect(renderTemplate("{{constructor|none}}", {}, { escape: false })).toBe("none");
  });

  it("inserts values containing $ patterns literally", () => {
    expect(renderTemplate("{{a}}", { a: "$& $1 $$" }, { escape: false })).toBe("$& $1 $$");
  });
});

describe("validateVariableMap", () => {
  it("is ok when everything has a source that cannot be empty", () => {
    const result = validateVariableMap([variable("email"), variable("company")], {
      company: { kind: "fixed", value: "Acme" },
    });
    expect(result).toEqual({ ok: true, unresolved: [], needsFallback: [] });
  });

  it("reports unmapped non-builtins without a fallback as unresolved", () => {
    const result = validateVariableMap([variable("company"), variable("city", true)], {});
    expect(result).toEqual({ ok: false, unresolved: ["company"], needsFallback: [] });
  });

  it("requires a fallback for column sources, first_name and blank fixed values", () => {
    const result = validateVariableMap(
      [variable("company"), variable("first_name"), variable("note"), variable("city", true), variable("greeting")],
      {
        company: { kind: "column", column: "Company" },
        note: { kind: "fixed", value: "  " },
        city: { kind: "column", column: "City" },
        greeting: { kind: "builtin", key: "first_name" },
      },
    );
    expect(result).toEqual({ ok: false, unresolved: [], needsFallback: ["company", "first_name", "note", "greeting"] });
  });

  it("accepts first_name with a fallback", () => {
    expect(validateVariableMap([variable("first_name", true)], {})).toEqual({ ok: true, unresolved: [], needsFallback: [] });
  });
});

describe("resolveFirstName", () => {
  it("prefers a first-name column, including header variants", () => {
    expect(resolveFirstName({ "First Name": " Ann ", name: "Bob Jones" }, "carl.smith@x.com")).toBe("Ann");
    expect(resolveFirstName({ "first-name": "Ann" }, "x@x.com")).toBe("Ann");
    expect(resolveFirstName({ FirstName: "Ann" }, "x@x.com")).toBe("Ann");
    expect(resolveFirstName({ first: "Ann" }, "x@x.com")).toBe("Ann");
  });

  it("falls back to the first token of a name column", () => {
    expect(resolveFirstName({ first_name: "  ", Name: "  Bob Jones" }, "carl.smith@x.com")).toBe("Bob");
    expect(resolveFirstName({ "Full Name": "Bob Jones" }, "x@x.com")).toBe("Bob");
  });

  it("falls back to guessing from the email", () => {
    expect(resolveFirstName({ company: "Acme" }, "carl.smith@x.com")).toBe("Carl");
    expect(resolveFirstName({}, "info@x.com")).toBeNull();
  });
});

describe("textToHtml", () => {
  it("escapes text and builds paragraphs and line breaks, keeping tags", () => {
    expect(textToHtml("Hi {{first_name}},\nA & B\n\n\nBye <3")).toBe("<p>Hi {{first_name}},<br>A &amp; B</p>\n<p>Bye &lt;3</p>");
  });

  it("handles CRLF line endings", () => {
    expect(textToHtml("a\r\nb\r\n\r\nc")).toBe("<p>a<br>b</p>\n<p>c</p>");
  });
});

describe("BUILTIN_KEYS", () => {
  it("lists the six builtins", () => {
    expect(BUILTIN_KEYS).toEqual(["email", "first_name", "domain", "unsubscribe_url", "postal_address", "today"]);
  });
});

describe("renderEmail", () => {
  const contact = { email: "jane.doe@acme.com", fields: { Company: "Acme <script>", first_name: "Jane", city: "Paris" } };

  it("resolves builtins", () => {
    const out = renderEmail(
      template({
        subject: "{{first_name}} at {{domain}}",
        html: "<p>{{email}} {{today}} {{postal_address}} {{unsubscribe_url}}</p>",
        text: "{{email}}",
      }),
      contact,
      ctx,
    );
    expect(out.subject).toBe("Jane at acme.com");
    expect(out.html).toBe(
      "<p>jane.doe@acme.com October 25, 2026 1 Main St, Springfield https://mail.example.com/u?t=abc&amp;s=1</p>",
    );
  });

  it("resolves map over builtin over field", () => {
    const fields = { first_name: "FieldName", city: "Paris", Town: "Lyon" };
    const out = renderEmail(
      template({
        subject: "s",
        html: "<p>{{first_name}} {{city}} {{email}}</p>",
        variableMap: { first_name: { kind: "fixed", value: "Mapped" }, city: { kind: "column", column: "Town" } },
      }),
      { email: "a@b.com", fields },
      ctx,
    );
    expect(out.html.startsWith("<p>Mapped Lyon a@b.com</p>")).toBe(true);

    const builtinWins = renderEmail(template({ html: "<p>{{email}}</p>" }), { email: "a@b.com", fields: { email: "other@x.com" } }, ctx);
    expect(builtinWins.html.startsWith("<p>a@b.com</p>")).toBe(true);
  });

  it("uses an exact CSV field for unmapped non-builtins", () => {
    const out = renderEmail(template({ html: "<p>{{city}}</p>" }), contact, ctx);
    expect(out.html.startsWith("<p>Paris</p>")).toBe(true);
  });

  it("throws MissingVariableError for an unresolvable variable without fallback", () => {
    expect(() => renderEmail(template({ html: "<p>{{zip}}</p>" }), contact, ctx)).toThrow(MissingVariableError);
  });

  it("escapes CSV values in html but not in the supplied text part", () => {
    const out = renderEmail(
      template({
        html: "<p>{{Company}}</p>",
        text: "{{Company}}",
        variableMap: { Company: { kind: "column", column: "Company" } },
      }),
      contact,
      ctx,
    );
    expect(out.html).toContain("<p>Acme &lt;script&gt;</p>");
    expect(out.html).not.toContain("<script>");
    expect(out.text.startsWith("Acme <script>")).toBe(true);
  });

  it("strips CR/LF injected through CSV values from the subject", () => {
    const out = renderEmail(
      template({ subject: "Hi {{first_name}}" }),
      { email: "a@b.com", fields: { first_name: "Eve\r\nBcc: victim@x.com" } },
      ctx,
    );
    expect(out.subject).toBe("Hi Eve Bcc: victim@x.com");
  });

  it("strips newlines in the subject template itself", () => {
    expect(renderEmail(template({ subject: "Hello\nthere" }), contact, ctx).subject).toBe("Hello there");
  });

  it("appends the compliance footer when the unsubscribe tag is absent", () => {
    const out = renderEmail(template({ html: "<p>Hi {{first_name}}</p>" }), contact, ctx);
    expect(out.html.startsWith("<p>Hi Jane</p>")).toBe(true);
    expect(out.html).toContain('href="https://mail.example.com/u?t=abc&amp;s=1"');
    expect(out.html).toContain(">Unsubscribe</a>");
    expect(out.html).toContain("1 Main St, Springfield");
    expect(out.html).toContain("#64748b");
    expect(out.html).toContain("#059669");
    expect(out.text).toBe("Hi Jane\n\n--\n1 Main St, Springfield\nUnsubscribe: https://mail.example.com/u?t=abc&s=1\n");
  });

  it("appends the footer when only the postal address tag is present", () => {
    const out = renderEmail(template({ html: "<p>{{postal_address}}</p>" }), contact, ctx);
    expect(out.html).toContain(">Unsubscribe</a>");
  });

  it("escapes the postal address and URL in the footer", () => {
    const out = renderEmail(template({}), contact, { ...ctx, postalAddress: "A <b> & Co", unsubscribeUrl: 'https://x.com/u?a="1"' });
    expect(out.html).toContain("A &lt;b&gt; &amp; Co");
    expect(out.html).toContain('href="https://x.com/u?a=&quot;1&quot;"');
  });

  it("does not duplicate the footer when both tags are present", () => {
    const html = '<p>Hi</p><p>{{ postal_address }} <a href="{{unsubscribe_url}}">Unsubscribe</a></p>';
    const out = renderEmail(template({ html }), contact, ctx);
    expect(out.html).toBe('<p>Hi</p><p>1 Main St, Springfield <a href="https://mail.example.com/u?t=abc&amp;s=1">Unsubscribe</a></p>');
    expect(out.text.match(/Unsubscribe/g)).toHaveLength(1);
    expect(out.text).not.toContain("\n--\n");
  });

  it("still appends the footer when an unsubscribe tag is remapped away from the builtin", () => {
    const html = '<p>{{postal_address}} <a href="{{unsubscribe_url}}">x</a></p>';
    const out = renderEmail(
      template({ html, variableMap: { unsubscribe_url: { kind: "fixed", value: "https://evil.example" } } }),
      contact,
      ctx,
    );
    expect(out.html).toContain('href="https://mail.example.com/u?t=abc&amp;s=1"');
  });

  it("appends the text footer when a supplied text part lacks the tags", () => {
    const html = '<p>{{postal_address}} <a href="{{unsubscribe_url}}">Unsubscribe</a></p>';
    const out = renderEmail(template({ html, text: "Hi there" }), contact, ctx);
    expect(out.html).not.toContain("#64748b");
    expect(out.text).toBe("Hi there\n\n--\n1 Main St, Springfield\nUnsubscribe: https://mail.example.com/u?t=abc&s=1\n");
  });

  it("inserts the html footer before </body>", () => {
    const out = renderEmail(template({ html: "<html><BODY><p>Hi</p></BODY></html>" }), contact, ctx);
    expect(out.html.startsWith("<html><BODY><p>Hi</p><")).toBe(true);
    expect(out.html.endsWith("</BODY></html>")).toBe(true);
    expect(out.html.indexOf("Unsubscribe")).toBeLessThan(out.html.indexOf("</BODY>"));
  });

  it("generates text from html when no text part is supplied", () => {
    const out = renderEmail(
      template({ html: '<p>Hi {{first_name}}</p><img src="x.png"><p><a href="https://acme.com">Visit</a></p>' }),
      contact,
      ctx,
    );
    expect(out.text.startsWith("Hi Jane\n\nVisit (https://acme.com)\n\n--\n")).toBe(true);
    expect(out.text).not.toContain("x.png");
  });

  it("never leaves a raw valid tag in the output", () => {
    const out = renderEmail(
      template({ subject: "{{first_name|x}}", html: "<p>{{ city }} {{ zip | 00000 }}</p>", text: "{{today}}" }),
      contact,
      ctx,
    );
    for (const part of [out.subject, out.html, out.text]) expect(part).not.toMatch(/\{\{/);
  });
});
