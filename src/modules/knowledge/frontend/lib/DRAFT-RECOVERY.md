# Native Docs draft recovery

`PageSaveCoordinator` owns pending title and body fields independently of editor mounts. Native
Electron injects the opaque `DraftJournal` bridge; browser-only sessions retain drafts in memory
and cannot claim restart recovery. The main process scopes journal files to the profile and the
canonical database path, not the renderer's ephemeral HTTP origin. Only the application's main
frame can call the journal IPC handlers.

The native store uses private files, per-key compare-and-swap tokens, a checksummed versioned
envelope, same-directory atomic rename, file sync and directory sync. Its single-process writer
assumption depends on the application's existing instance lock. This is not a cross-process lock.
Malformed, future, incorrectly keyed, non-regular and symlink records are refused and retained.
JSON values are limited to 16 MiB; no renderer-supplied filesystem paths are accepted.

Every pending-field snapshot records its original page revision and update timestamp. Journal
operations are serialized; lost acknowledgements retain the exact idempotent CAS request for an
explicit retry. Newer edits supersede queued snapshots without letting an old save acknowledgement
clear them. Backend saves wait for the journal acknowledgement. Metadata responses never replace
a pending body. Successful backend acknowledgement updates the baseline and removes only the
recognized record with the matching token.

Opening a page waits for journal lookup before enabling title/body editing. Supported recovered
Tiptap v1 content is checked against the editor schema; unknown nodes, marks, attributes and record
fields cannot be silently normalized. A recovered draft is displayed without automatic save.
Matching baselines offer Retry or Discard; changed baselines require an explicit Keep-and-retry
or Discard-and-reload decision. Journal acknowledgements do not reset editor history.

Pending or failed journal writes prevent unattended close. Electron's confirmation defaults to
Stay, and cancelling quit leaves the backend running. A failed backend save may close safely once
the latest draft is durably retained. Native tests cover window close and SIGKILL after journal
acknowledgement; immediate termination before that acknowledgement can still lose the newest edit.
Power-loss and storage-device failure durability have not been qualified.

Deleting a page suspends autosave for the loaded subtree. Pending records remain on disk; they are
not interpreted as authorization to recreate deleted pages. The store supports listing keys, but
there is not yet an orphan-record recovery UI. Unknown/unreadable records also need a separate
recovery workflow; they are never automatically overwritten or discarded. These limitations keep
the broader migration, backup and recovery acceptance gate open.
