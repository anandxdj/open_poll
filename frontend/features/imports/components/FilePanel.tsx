"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImportCapabilities } from "../hooks/useImportCapabilities";
import { useImportRun } from "../hooks/useImportRun";
import { SOURCE_ACCEPT, classifySourceFile, formatBytes } from "../logic";
import { FilePicker } from "./FilePicker";
import { JobStatus } from "./JobStatus";

export function Notice({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/30 p-3 text-xs text-foreground/80">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="space-y-0.5">
        {title ? <p className="font-semibold text-foreground/90">{title}</p> : null}
        <p>{children}</p>
      </div>
    </div>
  );
}

/** PowerPoint or PDF: choose, upload through the presign flow, follow the job. */
export function FilePanel() {
  const t = useTranslations("imports");
  const capabilities = useImportCapabilities();
  const { state, runFile, reset } = useImportRun();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  const storageOff = capabilities.known && !capabilities.storage;
  const check = file ? classifySourceFile(file) : null;
  const busy = state.phase === "uploading" || state.phase === "submitting" || state.phase === "tracking";

  const choose = (next: File) => {
    const result = classifySourceFile(next);
    if (!result.ok) {
      setFile(null);
      setFileError(t(`file.${result.reason === "type" ? "wrongType" : result.reason}`));
      return;
    }
    setFileError(null);
    setFile(next);
  };

  const submit = () => {
    if (file && check?.ok) void runFile(file, check.kind, title);
  };

  if (state.phase !== "idle") {
    return (
      <JobStatus
        state={state}
        onRetry={submit}
        onReset={() => {
          reset();
          setFile(null);
          setTitle("");
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {storageOff ? <Notice title={t("capabilities.storageOffTitle")}>{t("capabilities.storageOff")}</Notice> : null}
      <FilePicker
        accept={SOURCE_ACCEPT}
        label={t("file.drop")}
        selected={file ? t("file.selected", { name: file.name, size: formatBytes(file.size) }) : null}
        onFile={choose}
        disabled={storageOff || busy}
        error={fileError}
      />
      <p className="text-xs text-muted-foreground">{t("file.hint")}</p>
      {capabilities.known && !storageOff ? (
        <Notice>{capabilities.pptxHighFidelity ? t("capabilities.renderOn") : t("capabilities.renderOff")}</Notice>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="import-file-title">{t("file.titleLabel")}</Label>
        <Input
          id="import-file-title"
          value={title}
          maxLength={120}
          placeholder={t("file.titlePlaceholder")}
          onChange={(event) => setTitle(event.target.value)}
          disabled={storageOff}
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={!file || !check?.ok || storageOff || busy}>
          {t("file.submit")}
        </Button>
      </div>
    </div>
  );
}
