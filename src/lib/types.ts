/**
 * Domain model for the Sejuk Sejuk Service operations system.
 *
 * Kept deliberately framework-free so the same types are shared by the React
 * app, the Supabase data layer and the serverless AI query function.
 */

export type Role = 'Admin' | 'Technician' | 'Manager';

/** Simplified workflow state from the brief: New → Assigned → In Progress → Job Done → Reviewed → Closed */
export type OrderStatus = 'New' | 'Assigned' | 'In Progress' | 'Job Done' | 'Reviewed' | 'Closed';

export type ServiceType = 'Installation' | 'Cleaning' | 'Repair' | 'Gas Refill' | 'Inspection';

export const SERVICE_TYPES: ServiceType[] = ['Installation', 'Cleaning', 'Repair', 'Gas Refill', 'Inspection'];

/** Field teams are mocked in the brief: Ali, John, Bala, Yusoff. */
export const TECHNICIANS = ['Ali', 'John', 'Bala', 'Yusoff'] as const;
export type Technician = (typeof TECHNICIANS)[number];

export type PaymentMethod = 'Cash' | 'Bank Transfer' | 'DuitNow QR' | 'Card';

export interface Attachment {
  id: string;
  report_id: string;
  name: string;
  /** MIME type — the brief allows photos, video or PDF, max 6 per job. */
  mime: string;
  size: number;
  /** Object URL in demo mode, Supabase Storage public URL in cloud mode. */
  url: string;
}

export interface Order {
  order_no: string;
  customer_name: string;
  phone: string;
  address: string;
  problem_description: string;
  service_type: ServiceType;
  quoted_price: number;
  assigned_technician: Technician | null;
  status: OrderStatus;
  admin_notes: string;
  created_at: string;
  updated_at: string;
}

export interface ServiceReport {
  id: string;
  order_no: string;
  work_done: string;
  extra_charges: number;
  /** quoted_price + extra_charges, computed — never typed by hand. */
  final_amount: number;
  remarks: string;
  technician_name: string;
  completed_at: string;
  /** Optional (bonus) payment captured in the field. */
  payment_amount: number | null;
  payment_method: PaymentMethod | null;
  attachments: Attachment[];
}

export type EventType =
  | 'created'
  | 'assigned'
  | 'started'
  | 'completed'
  | 'rescheduled'
  | 'reviewed'
  | 'closed'
  | 'notified'
  | 'payment_recorded';

/** Every key action is traceable — the brief asks for this explicitly. */
export interface OrderEvent {
  id: string;
  order_no: string;
  event_type: EventType;
  actor_role: Role | 'System';
  actor_name: string;
  detail: string;
  created_at: string;
}

export interface NotificationRecord {
  id: string;
  order_no: string;
  channel: 'whatsapp';
  /** Customer phone the message is addressed to. */
  target: string;
  message: string;
  /** 'prepared' = deep link generated for the technician/admin to send; 'sent' recorded by the user. */
  status: 'prepared' | 'sent';
  deep_link: string;
  created_at: string;
}

export interface OpsData {
  orders: Order[];
  reports: ServiceReport[];
  events: OrderEvent[];
  notifications: NotificationRecord[];
}
