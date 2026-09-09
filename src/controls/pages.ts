/**
 * Reviewed public SimTrain page paths.
 *
 * Includes direct pages backed by public Mini API document resources and
 * selected top-level user navigation. The values are relative to the current
 * organization. Dynamic record IDs are supplied separately through
 * `NavigateToInput.id`.
 */
export type KnownSimTrainPage =
  | ""
  | "academysession"
  | "activity"
  | "agent"
  | "announcement"
  | "announcementtype"
  | "area"
  | "category"
  | "creditnote"
  | "enrollment"
  | "holiday"
  | "integrations"
  | "invoice"
  | "level"
  | "manageclasses"
  | "managestudents"
  | "miniapp"
  | "parent"
  | "payment"
  | "paymentmethod"
  | "product"
  | "race"
  | "refund"
  | "refundtype"
  | "religion"
  | "reports"
  | "reward"
  | "rewardtype"
  | "room"
  | "roomtype"
  | "school"
  | "settings"
  | "stopreason"
  | "student"
  | "studentgroup"
  | "studentsource"
  | "teacher"
  | "teachergroup"
  | "tuitionclass";

/**
 * A page path inside the current SimTrain organization.
 *
 * Known pages receive editor autocomplete. Other strings remain accepted so a
 * newly deployed SimTrain page does not require a new SDK release first.
 */
export type SimTrainPage = KnownSimTrainPage | (string & Record<never, never>);
