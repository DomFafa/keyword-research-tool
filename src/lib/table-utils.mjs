export function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export function rowToObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row?.[index] || ""]));
}

export function valuesToTable(values) {
  const headers = values[0] || [];
  return {
    headers,
    rows: values.slice(1).map((row, index) => ({
      rowNumber: index + 2,
      values: row,
      record: rowToObject(headers, row)
    }))
  };
}

export function headerIndex(headers, header, tableName = "表格") {
  const index = headers.indexOf(header);
  if (index === -1) {
    throw new Error(`${tableName} 缺少表头: ${header}`);
  }
  return index;
}

export function optionalHeaderIndex(headers, header) {
  return headers.indexOf(header);
}
