"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImportCapabilities } from "../hooks/useImportCapabilities";
import { useImportRun } from "../hooks/useImportRun";
import { parseGoogleSlidesLink } from "../logic";
import { JobStatus } from "./JobStatus";
import { Notice } from "./FilePanel";

/** A public Google Slides link; private Drive files only where the server has Drive import configured. */
export function GooglePanel() {
  const t = useTranslations("imports");
  const capabilities = useImportCapabilities();
  const { state, runLink, reset } = useImportRun();
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);

  const valid = parseGoogleSlidesLink(link) !== null;
  const showError = touched && link.trim() !== "" && !valid;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (valid) void runLink(link, title);
  };

  if (state.phase !== "idle") {
    return (
      <JobStatus
        state={state}
        onRetry={submit}
        onReset={() => {
          reset();
          setLink("");
          setTitle("");
          setTouched(false);
        }}
      />
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="import-google-link">{t("google.linkLabel")}</Label>
        <Input
          id="import-google-link"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={link}
          placeholder={t("google.linkPlaceholder")}
          aria-invalid={showError}
          aria-describedby={showError ? "import-google-error" : "import-google-hint"}
          onChange={(event) => setLink(event.target.value)}
          onBlur={() => setTouched(true)}
        />
        {showError ? (
          <p id="import-google-error" role="alert" className="text-xs text-destructive">
            {t("google.invalid")}
          </p>
        ) : (
          <p id="import-google-hint" className="text-xs text-muted-foreground">
            {t("google.hint")}
          </p>
        )}
      </div>
      {capabilities.known && !capabilities.storage ? <Notice>{t("capabilities.storageOffGoogle")}</Notice> : null}
      {capabilities.known ? (
        <Notice>{capabilities.googleDriveImport ? t("capabilities.driveOn") : t("capabilities.driveOff")}</Notice>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="import-google-title">{t("google.titleLabel")}</Label>
        <Input
          id="import-google-title"
          value={title}
          maxLength={120}
          placeholder={t("google.titlePlaceholder")}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!valid}>
          {t("google.submit")}
        </Button>
      </div>
    </form>
  );
}
