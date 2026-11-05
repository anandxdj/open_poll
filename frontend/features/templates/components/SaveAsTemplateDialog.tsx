"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api-error";
import { MAX_TEMPLATE_TITLE, saveAsTemplate, TEMPLATES_PATH } from "../api";

interface SaveAsTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  deckTitle: string;
}

/** Names and saves a workspace template from a deck (the deck itself is not changed). */
export function SaveAsTemplateDialog({ open, onOpenChange, deckId, deckTitle }: SaveAsTemplateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <SaveForm deckId={deckId} deckTitle={deckTitle} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SaveForm({ deckId, deckTitle, onDone }: { deckId: string; deckTitle: string; onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(deckTitle.slice(0, MAX_TEMPLATE_TITLE));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give the template a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveAsTemplate(deckId, trimmed);
      toast.success("Saved as a template.", { action: { label: "View templates", onClick: () => router.push(TEMPLATES_PATH) } });
      onDone();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err) ?? "Couldn't save the template.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>Save as template</DialogTitle>
        <DialogDescription>
          Everyone in this workspace can start a new deck from it on the Templates page. Later edits to this deck do not change the
          template.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-5 space-y-2">
        <Label htmlFor="template-title">Template name</Label>
        <Input
          id="template-title"
          value={title}
          autoFocus
          autoComplete="off"
          maxLength={MAX_TEMPLATE_TITLE}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "template-title-error" : undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            if (error) setError(null);
          }}
        />
        {error ? (
          <p id="template-title-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save template
        </Button>
      </DialogFooter>
    </form>
  );
}
