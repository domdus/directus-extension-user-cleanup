# User Cleanup

Delete users that Directus refuses to remove because other items still point at them.

Some of those items' fields block the delete until they are cleared or pointed at someone else. User Cleanup lists every field, marks it **Blocking** or **Not blocking**, and applies the action you choose. Nothing is written until you confirm.

Open **User Cleanup** from the left bar (**admins only**).

<img alt="User Cleanup wizard on the Select step, with the current admin marked You" src="https://raw.githubusercontent.com/domdus/directus-extension-user-cleanup/main/docs/user-cleanup.png" width="800" />

## Wizard

Four steps. Nothing is written until **Delete**:

1. **Select** — pick users. Your own user stays, and the last admin cannot be removed.
2. **Inspect** — every foreign key that still points at the selection, with item counts and whether it blocks deletion.
3. **Resolve** — choose what happens to each reference. Filter to **Blocking** when you only need the ones that stop the delete.
4. **Delete** — apply those changes in one transaction, then delete the users.

<img alt="Inspect step listing references, item counts, on-delete rules, and which ones are blocking" src="https://raw.githubusercontent.com/domdus/directus-extension-user-cleanup/main/docs/user-cleanup_inspect.png" width="800" />

<img alt="Resolve step filtered to blocking references, with Set Null chosen for content fields" src="https://raw.githubusercontent.com/domdus/directus-extension-user-cleanup/main/docs/user-cleanup_resolve.png" width="800" />

| Action | What it does |
| --- | --- |
| **Set Null** | Keeps the row and clears the user. Offered when the column is nullable. |
| **Reassign** | Points the row at another user. Required when the column cannot be empty. |
| **Delete Rows** | Removes those rows. Offered for sessions, access, permission overrides, presets, inbox notifications, and M2M junction links. |
| **Leave As Is** | Offered only when the reference does not block deletion. |

Files stay in the library. Set Null or Reassign on `directus_files` only changes who uploaded or edited the file.

Sessions, access grants, permission overrides, and inbox notifications are removed with the user even when they were not in the inspect list.

## What this does not do

- It does not delete files or other content the user created.
- It does not run automatically when someone uses the built-in user delete.
- It does not rewrite foreign keys in the database schema.

## Installation

Requires **Directus 9.26+ through 12.x**.

1. Install and build:

```bash
cd directus-extension-user-cleanup
npm install
npm run build
```

2. Copy the built package into your Directus `extensions` folder (include `package.json` and the `dist` folder).

3. Restart Directus.

4. In the Data Studio:

   1. Open **Settings → Project Settings → Modules**
   2. Enable **User Cleanup**
   3. Open **User Cleanup** from the left bar
