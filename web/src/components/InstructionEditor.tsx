// TipTap rich-text editing for step instructions: bold, italic, links.
// Plain template-generated text loads fine; edits are stored as HTML (the
// backend converts to Markdown on export).

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";

export default function InstructionEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (html: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const lastSaved = useRef<string>("");

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: value,
    editorProps: {
      attributes: {
        class:
          "tiptap-instruction min-h-8 rounded-md border border-transparent px-2 py-1.5 " +
          "text-[15px] leading-snug hover:border-zinc-200 focus:border-brand focus:outline-none",
      },
    },
    onCreate: ({ editor }) => {
      lastSaved.current = editor.getHTML();
    },
    onFocus: () => setFocused(true),
    onBlur: ({ editor }) => {
      setFocused(false);
      const html = editor.getHTML();
      if (html !== lastSaved.current) {
        lastSaved.current = html;
        onSave(html);
      }
    },
  });

  // External changes (regenerate, merge) refresh the editor unless mid-edit.
  useEffect(() => {
    if (editor && !editor.isFocused) {
      editor.commands.setContent(value);
      lastSaved.current = editor.getHTML();
    }
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const existing = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", existing ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <div className="min-w-0 flex-1">
      <EditorContent editor={editor} />
      {focused && (
        <div
          className="mt-1 flex gap-1 text-xs"
          onMouseDown={(e) => e.preventDefault()} // keep editor focus while clicking toolbar
        >
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`rounded border px-2 py-0.5 font-bold ${
              editor.isActive("bold") ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"
            }`}
          >
            B
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`rounded border px-2 py-0.5 italic ${
              editor.isActive("italic")
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300"
            }`}
          >
            I
          </button>
          <button
            onClick={setLink}
            className={`rounded border px-2 py-0.5 underline ${
              editor.isActive("link") ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"
            }`}
          >
            link
          </button>
        </div>
      )}
    </div>
  );
}
