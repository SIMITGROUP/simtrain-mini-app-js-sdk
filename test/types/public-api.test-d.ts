import {
  SimTrainSdk,
  type CurrentNavigateToInput,
  type ListStudentsParams,
  type NavigateToInput,
  type RequestOptions,
  type SimTrainPage,
  type KnownSimTrainPage,
  type StudentPaginatedResponse,
} from "../../src";

// @ts-expect-error generated implementation bases are not public API
import type { SimTrainSdkBase } from "../../src";
// @ts-expect-error server-only auth DTOs are not public API
import type { DevAuthDto } from "../../src";

type Equal<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type Expect<Value extends true> = Value;

type ConstructorNeedsNoConfiguration = Expect<
  Equal<ConstructorParameters<typeof SimTrainSdk>, []>
>;
type StudentListInputIsGenerated = Expect<
  Equal<
    Parameters<SimTrainSdk["students"]["list"]>[0],
    ListStudentsParams | undefined
  >
>;
type StudentListOptionsArePublic = Expect<
  Equal<
    Parameters<SimTrainSdk["students"]["list"]>[1],
    RequestOptions | undefined
  >
>;
type StudentListOutputIsGenerated = Expect<
  Equal<
    ReturnType<SimTrainSdk["students"]["list"]>,
    Promise<StudentPaginatedResponse>
  >
>;
type AuthReturnsTheBearerToken = Expect<
  Equal<ReturnType<SimTrainSdk["auth"]["getToken"]>, Promise<string>>
>;
type NavigateInputIsPublic = Expect<
  Equal<Parameters<SimTrainSdk["ui"]["navigateTo"]>[0], NavigateToInput>
>;
type CurrentNavigateInputIsPublic = Expect<
  Equal<
    Parameters<SimTrainSdk["current"]["navigateTo"]>[0],
    CurrentNavigateToInput
  >
>;
type ExpectedKnownSimTrainPage =
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
type KnownPagesMatchReviewedPublicNavigation = Expect<
  Equal<KnownSimTrainPage, ExpectedKnownSimTrainPage>
>;
type ArbitraryPageRemainsAccepted = Expect<
  Equal<"future/new-page" extends SimTrainPage ? true : false, true>
>;
type StudentFormUsesOnlyIdAndOptions = Expect<
  Equal<
    Parameters<SimTrainSdk["students"]["openOnScreenForm"]>[0],
    string | undefined
  >
>;
type StudentFormOptionsArePublic = Expect<
  Equal<
    Parameters<SimTrainSdk["students"]["openOnScreenForm"]>[1],
    import("../../src").ControlOptions | undefined
  >
>;
type MeHasNoForm = Expect<
  Equal<
    "openOnScreenForm" extends keyof SimTrainSdk["me"] ? true : false,
    false
  >
>;
type UiHasNoGenericForm = Expect<
  Equal<
    "openOnScreenForm" extends keyof SimTrainSdk["ui"] ? true : false,
    false
  >
>;
type NoExchangeMethod = Expect<
  Equal<"exchange" extends keyof SimTrainSdk["auth"] ? true : false, false>
>;
type NoClientSecret = Expect<
  Equal<"clientSecret" extends keyof SimTrainSdk ? true : false, false>
>;

export interface PublicApiContractAssertions {
  readonly forbiddenGeneratedBase: SimTrainSdkBase;
  readonly forbiddenServerAuthDto: DevAuthDto;
  readonly constructorNeedsNoConfiguration: ConstructorNeedsNoConfiguration;
  readonly studentListInputIsGenerated: StudentListInputIsGenerated;
  readonly studentListOptionsArePublic: StudentListOptionsArePublic;
  readonly studentListOutputIsGenerated: StudentListOutputIsGenerated;
  readonly authReturnsTheBearerToken: AuthReturnsTheBearerToken;
  readonly navigateInputIsPublic: NavigateInputIsPublic;
  readonly currentNavigateInputIsPublic: CurrentNavigateInputIsPublic;
  readonly noExchangeMethod: NoExchangeMethod;
  readonly noClientSecret: NoClientSecret;
  readonly knownPagesMatchReviewedPublicNavigation: KnownPagesMatchReviewedPublicNavigation;
  readonly arbitraryPageRemainsAccepted: ArbitraryPageRemainsAccepted;
  readonly studentFormUsesOnlyIdAndOptions: StudentFormUsesOnlyIdAndOptions;
  readonly studentFormOptionsArePublic: StudentFormOptionsArePublic;
  readonly meHasNoForm: MeHasNoForm;
  readonly uiHasNoGenericForm: UiHasNoGenericForm;
}

declare const sdk: SimTrainSdk;
sdk.ui.navigateTo({ page: "managestudents" });
sdk.ui.navigateTo({ page: "future/new-page" });
// @ts-expect-error V2 uses page, not the removed destination alias.
sdk.ui.navigateTo({ destination: "students" });
sdk.students.openOnScreenForm();
sdk.students.openOnScreenForm("student-1", {
  signal: new AbortController().signal,
});
// @ts-expect-error Resource selection is generated, not developer-supplied.
sdk.ui.openOnScreenForm({ resource: "students" });
