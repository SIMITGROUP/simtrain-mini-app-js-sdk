import type { QueryParameter } from "./transport";

function primitive(value: unknown, label: string): string {
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new TypeError(`${label} must be a finite primitive value`);
}

export function interpolatePath(
  template: string,
  parameters: Readonly<Record<string, unknown>> = {}
): string {
  if (
    !template.startsWith("/v2/") ||
    /[\\?#\0]/.test(template) ||
    template.split("/").some(segment => {
      try {
        const decoded = decodeURIComponent(segment);
        return (
          decoded === "." ||
          decoded === ".." ||
          decoded.includes("/") ||
          decoded.includes("\\")
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new TypeError("transport path is unsafe");
  }
  const placeholders = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map(match => match[1])
    .filter((name): name is string => name !== undefined);
  for (const name of Object.keys(parameters)) {
    if (!placeholders.includes(name)) {
      throw new TypeError(`extra path parameter: ${name}`);
    }
  }
  const path = template.replace(
    /\{([A-Za-z][A-Za-z0-9]*)\}/g,
    (_placeholder, name: string) => {
      if (!Object.hasOwn(parameters, name)) {
        throw new TypeError(`missing path parameter: ${name}`);
      }
      return encodeURIComponent(
        primitive(parameters[name], `path parameter ${name}`)
      );
    }
  );
  if (/[{}]/.test(path))
    throw new TypeError("malformed path parameter template");
  return path;
}

function appendValue(
  query: URLSearchParams,
  name: string,
  value: unknown
): void {
  if (value === undefined) return;
  if (value === null) {
    query.append(name, "");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      query.append(name, primitive(item, `query ${name}`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new TypeError(`unsafe query object key: ${key}`);
      }
      query.append(key, primitive(item, `query ${name}.${key}`));
    }
    return;
  }
  query.append(name, primitive(value, `query ${name}`));
}

export function serializeQuery(
  parameters: readonly QueryParameter[] = []
): string {
  const query = new URLSearchParams();
  for (const parameter of parameters) {
    appendValue(query, parameter.name, parameter.value);
  }
  return query.toString();
}
