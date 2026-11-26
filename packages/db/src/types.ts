export type AppRole = "guest" | "cashier" | "kitchen" | "waiter" | "admin";
export type OrderStatus = "pending" | "approved" | "preparing" | "ready" | "served" | "paid" | "rejected";
export type TableStatus = "available" | "occupied" | "out_of_service";
export type PaymentMethod = "cash" | "card";

export interface OrderRow {
  id: string;
  order_no: number;
  session_id: string;
  table_id: string;
  status: OrderStatus;
  subtotal: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  placed_at: string;
}

export interface ProductRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  price: number;
  image_path: string | null;
  is_available: boolean;
  category_id: string;
  station: "kitchen" | "grill" | "bar" | "dessert";
}

export interface TableRow {
  id: string;
  number: number;
  seats: number;
  qr_token: string;
  status: TableStatus;
}
