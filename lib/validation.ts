import { AppError } from "./errors";

export const isValidPhone = (value: string) => /^1\d{10}$/.test(value);

export const isValidDateOnly = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

export const requireNonEmptyString = (value: unknown, field: string, maxLength?: number) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("VALIDATION_ERROR", `${field} 不能为空`, 400, { field });
  }

  const trimmed = value.trim();
  if (maxLength && trimmed.length > maxLength) {
    throw new AppError("VALIDATION_ERROR", `${field} 不能超过 ${maxLength} 个字符`, 400, {
      field,
      maxLength,
    });
  }

  return trimmed;
};

export const parsePagination = (searchParams: URLSearchParams) => {
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "20");

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("VALIDATION_ERROR", "page 必须是正整数", 400, { field: "page" });
  }

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new AppError("VALIDATION_ERROR", "pageSize 必须是 1 到 100 的整数", 400, {
      field: "pageSize",
    });
  }

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
};
