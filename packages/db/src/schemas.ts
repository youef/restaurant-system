import { z } from "zod";

export const CartItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  notes: z.string().max(250).optional()
});

export const PlaceOrderSchema = z.object({
  p_session_id: z.string().uuid(),
  p_items: z.array(CartItemSchema).min(1).max(30),
  p_notes: z.string().max(500).optional()
});

export const AddTablesSchema = z.object({
  p_count: z.number().int().min(1).max(100),
  p_seats: z.number().int().min(1).max(30)
});

export const AdvanceOrderSchema = z.object({
  p_order_id: z.string().uuid(),
  p_to_status: z.enum(["approved", "rejected", "preparing", "ready", "served"]),
  p_reason: z.string().max(500).optional()
});
