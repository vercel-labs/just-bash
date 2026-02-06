import {
  FILE_README,
  FILE_LICENSE,
  FILE_PACKAGE_JSON,
  FILE_AGENTS_MD,
  FILE_WTF_IS_THIS,
} from "../../components/terminal-content";

const FILES: Record<string, string> = {
  "README.md": FILE_README,
  "LICENSE": FILE_LICENSE,
  "package.json": FILE_PACKAGE_JSON,
  "AGENTS.md": FILE_AGENTS_MD,
  "wtf-is-this.md": FILE_WTF_IS_THIS,
};

export function generateStaticParams() {
  return [
    { path: [] }, // /md -> README.md
    ...Object.keys(FILES).map((file) => ({ path: [file] })),
  ];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  let { path } = await params;
  const filePath = path?.join("/").replace(/^md\//, "") || "README.md";

  const content = FILES[filePath];

  if (!content) {
    return new Response(`File not found: ${filePath}\n\nAvailable files:\n${Object.keys(FILES).join("\n")}`, {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const contentType = filePath.endsWith(".json")
    ? "application/json"
    : filePath.endsWith(".md")
      ? "text/markdown; charset=utf-8"
      : "text/plain; charset=utf-8";

  return new Response(content, {
    headers: { "Content-Type": contentType },
  });
}
