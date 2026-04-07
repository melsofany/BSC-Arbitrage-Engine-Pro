import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value));
}

export function calculateProfit(price1: number, price2: number, amount: number = 1) {
  const diff = Math.abs(price1 - price2);
  const percentage = (diff / Math.min(price1, price2)) * 100;
  return {
    diff,
    percentage,
    profit: diff * amount,
  };
}
