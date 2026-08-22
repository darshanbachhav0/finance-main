import { Eye, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import DataTable from "./DataTable.jsx";
import Drawer from "./Drawer.jsx";
import Message from "./Message.jsx";
import PageHeader from "./PageHeader.jsx";
import StatusBadge from "./StatusBadge.jsx";

function defaultValue(fields) {
  return Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? (field.type === "checkbox" ? false : field.type === "file" ? [] : "")]));
}

export default function ResourceManager({
  title,
  description,
  endpoint,
  fields,
  columns,
  transformSubmit,
  readOnly = false,
  allowCreate,
  allowEdit,
  allowDelete,
  deleteMode = "delete",
  duplicateFields = [],
  confirmSubmit,
  renderDetails,
  detailsTitle = "Record details",
  renderHeaderActions
}) {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [form, setForm] = useState(defaultValue(fields));
  const [editing, setEditing] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const canCreate = allowCreate ?? !readOnly;
  const canEdit = allowEdit ?? !readOnly;
  const canDelete = allowDelete ?? !readOnly;
  const resourceTable = usePaginatedResource(endpoint);
  const { rows, loading } = resourceTable;

  function startCreate(initialValues = {}) {
    setEditing(null);
    setForm({ ...defaultValue(fields), ...initialValues });
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function startEdit(row) {
    const next = {};
    fields.forEach((field) => {
      const rowValue = field.getValue ? field.getValue(row) : row[field.name];
      if (field.type === "file") next[field.name] = [];
      else if (field.type === "date" && rowValue) next[field.name] = rowValue.slice(0, 10);
      else next[field.name] = rowValue ?? field.defaultValue ?? "";
    });
    setEditing(row);
    setForm(next);
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function validate() {
    const next = {};
    fields.forEach((field) => {
      const value = form[field.name];
      if ((field.required || (!editing && field.requiredOnCreate)) && (value === "" || value === null || value === undefined)) next[field.name] = "This field is required.";
      if (field.validate) {
        const validationMessage = field.validate(value, form, rows);
        if (validationMessage) next[field.name] = validationMessage;
      }
    });
    duplicateFields.forEach((fieldName) => {
      const value = String(form[fieldName] || "").trim().toLowerCase();
      if (value && rows.some((row) => row._id !== editing?._id && String(row[fieldName] || "").trim().toLowerCase() === value)) {
        next[fieldName] = "This value already exists.";
      }
    });
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function performSubmit() {
    setSaving(true);
    setActionError("");
    try {
      const payload = transformSubmit ? transformSubmit(form) : form;
      const multipart = fields.some((field) => field.type === "file");
      let requestPayload = payload;
      let config;
      if (multipart) {
        requestPayload = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (Array.isArray(value)) value.forEach((item) => requestPayload.append(key, item));
          else if (value !== undefined && value !== null) requestPayload.append(key, value);
        });
        config = { headers: { "Content-Type": "multipart/form-data" } };
      }
      const response = editing
        ? await api.put(`${endpoint}/${editing._id}`, requestPayload, config)
        : await api.post(endpoint, requestPayload, config);
      notify(editing ? "Record updated." : "Record created.");
      for (const warning of response.data.warnings || []) notify(`${warning.code}: ${warning.supplierName || "Review the related record."}`, "warning");
      setDrawerOpen(false);
      setConfirm(null);
      resourceTable.reload();
    } catch (err) {
      setActionError(err.details ? `${err.message} ${JSON.stringify(err.details)}` : err.message);
      notify(err.message, "error");
      setConfirm(null);
    } finally {
      setSaving(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!validate()) return;
    const confirmation = confirmSubmit?.(form, editing);
    if (confirmation) {
      setConfirm({ kind: "submit", ...confirmation });
      return;
    }
    performSubmit();
  }

  async function remove() {
    setSaving(true);
    try {
      await api.delete(`${endpoint}/${confirm.row._id}`);
      notify(deleteMode === "deactivate" ? "Record deactivated." : "Record permanently deleted.");
      setConfirm(null);
      resourceTable.reload();
    } catch (err) {
      setActionError(err.message);
      notify(err.message, "error");
      setConfirm(null);
    } finally {
      setSaving(false);
    }
  }

  const tableFilters = useMemo(() => {
    if (rows.some((row) => typeof row.active === "boolean")) {
      return [{ key: "active", label: "status", allLabel: "All statuses", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] }];
    }
    if (rows.some((row) => typeof row.status === "string")) {
      return [{ key: "status", label: "status", allLabel: "All statuses", options: [...new Set(rows.map((row) => row.status).filter(Boolean))] }];
    }
    return [];
  }, [rows]);

  const normalizedColumns = columns.map((column) => {
    if (column.key === "status" && !column.render) return { ...column, render: (row) => <StatusBadge status={row.status} /> };
    if (column.key === "active" && !column.render) return { ...column, render: (row) => <StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} /> };
    return column;
  });

  const actions = (row) => [
    ...(renderDetails ? [{ label: "View details", icon: Eye, onClick: () => setDetailRow(row) }] : []),
    ...(canEdit ? [{ label: "Edit", icon: Pencil, onClick: () => startEdit(row) }] : []),
    ...(canDelete ? [
      {
        label: deleteMode === "deactivate" ? "Deactivate" : "Delete permanently",
        icon: Trash2,
        tone: "danger",
        onClick: () => setConfirm({
          kind: "remove",
          row,
          title: deleteMode === "deactivate" ? "Deactivate record?" : "Permanently delete record?",
          description: deleteMode === "deactivate"
            ? "The record will remain in history but cannot be used for new operations."
            : "This record will be permanently removed and cannot be restored.",
          confirmLabel: deleteMode === "deactivate" ? "Deactivate" : "Delete permanently"
        })
      }
    ] : [])
  ];

  return (
    <section>
      <PageHeader
        title={title}
        description={description}
        actions={canCreate && (
          <>
            {renderHeaderActions?.({ rows, startCreate, startEdit })}
            <button type="button" className="primary-button" onClick={() => startCreate()}><Plus size={16} /><span>{t("New record")}</span></button>
          </>
        )}
      />
      <Message type="error">{actionError || resourceTable.error}</Message>
      <div className="workspace-panel">
        <DataTable rows={rows} columns={normalizedColumns} loading={loading} filters={tableFilters} rowActions={actions} caption={title} remote={resourceTable.remote} />
      </div>

      <Drawer
        open={drawerOpen}
        title={editing ? "Edit record" : "New record"}
        description={title}
        onClose={() => !saving && setDrawerOpen(false)}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={() => setDrawerOpen(false)} disabled={saving}>{t("Cancel")}</button>
            <button type="submit" form="resource-form" className="primary-button" disabled={saving}><Save size={16} /><span>{t(saving ? "Saving..." : editing ? "Update" : "Create")}</span></button>
          </>
        }
      >
        <form id="resource-form" className="form-grid" onSubmit={submit} noValidate>
          {fields.map((field) => (
            <label key={field.name} className={`field${fieldErrors[field.name] ? " field-error" : ""}`}>
              <span>{t(field.label)}{field.required || (!editing && field.requiredOnCreate) ? " *" : ""}</span>
              {field.type === "select" ? (
                <select value={form[field.name]} required={field.required} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}>
                  <option value="">{t("Select")}</option>
                  {field.options.map((option) => <option key={option.value ?? option} value={option.value ?? option}>{t(option.label ?? option)}</option>)}
                </select>
              ) : field.type === "checkbox" ? (
                <span className="toggle-field">
                  <input type="checkbox" checked={Boolean(form[field.name])} onChange={(event) => setForm({ ...form, [field.name]: event.target.checked })} />
                  <span>{t(form[field.name] ? "Active" : "Inactive")}</span>
                </span>
              ) : field.type === "file" ? (
                <><input type="file" accept={field.accept} multiple={field.multiple} onChange={(event) => setForm({ ...form, [field.name]: Array.from(event.target.files || []) })} /><small className="field-hint">{form[field.name]?.map((file) => file.name).join(", ") || t(field.placeholder || "Choose file")}</small></>
              ) : field.type === "multiselect" ? (
                <select multiple value={Array.isArray(form[field.name]) ? form[field.name] : []} onChange={(event) => setForm({ ...form, [field.name]: Array.from(event.target.selectedOptions, (option) => option.value) })}>
                  {field.options.map((option) => <option key={option.value ?? option} value={option.value ?? option}>{t(option.label ?? option)}</option>)}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  rows={field.rows || 4}
                  value={form[field.name]}
                  required={field.required}
                  placeholder={t(field.placeholder || "")}
                  onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}
                />
              ) : (
                <input
                  type={field.type || "text"}
                  value={form[field.name]}
                  required={field.required}
                  step={field.step}
                  min={field.min}
                  placeholder={t(field.placeholder || "")}
                  onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}
                />
              )}
              {fieldErrors[field.name] && <small className="field-error-text">{t(fieldErrors[field.name])}</small>}
              {field.hint && <small className="field-hint">{t(field.hint)}</small>}
            </label>
          ))}
        </form>
      </Drawer>

      <Drawer open={Boolean(detailRow)} title={detailsTitle} description={detailRow?.name || detailRow?.code || detailRow?.period} onClose={() => setDetailRow(null)}>
        {detailRow && renderDetails?.(detailRow)}
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        description={confirm?.description}
        details={confirm?.details}
        confirmLabel={confirm?.confirmLabel}
        tone={confirm?.tone || (confirm?.kind === "remove" ? "danger" : "primary")}
        loading={saving}
        onClose={() => !saving && setConfirm(null)}
        onConfirm={() => confirm?.kind === "submit" ? performSubmit() : remove()}
      />
    </section>
  );
}
