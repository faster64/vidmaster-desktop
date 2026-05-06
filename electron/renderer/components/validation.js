function pickValue(p, obj) {
  if (!obj) return undefined;
  return p.split(".").reduce((acc, k) => acc?.[k], obj);
}

function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

export async function validateConfig({ fields, config, fsExists }) {
  if (!Array.isArray(fields)) return [];

  const errors = [];
  const checks = [];

  fields.forEach((f, i) => {
    const v = pickValue(f.path, config);

    if (f.required && isEmpty(v)) {
      errors.push({ i, label: f.label, reason: "trống" });
      return;
    }

    if (f.mustExist && !isEmpty(v)) {
      checks.push(
        fsExists(v).then((r) => {
          if (!r.exists) {
            errors.push({ i, label: f.label, reason: "không tồn tại" });
          } else if (f.mustExist === "folder" && !r.isFolder) {
            errors.push({ i, label: f.label, reason: "sai loại" });
          } else if (f.mustExist === "file" && !r.isFile) {
            errors.push({ i, label: f.label, reason: "sai loại" });
          }
        })
      );
    }
  });

  await Promise.all(checks);
  errors.sort((a, b) => a.i - b.i);
  return errors.map(({ i, ...rest }) => rest);
}
