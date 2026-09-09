import type {
  AcademySessionPatchRequest,
  StudentCreateRequest,
  StudentResponse,
} from "../../src/generated/dto";

type Equal<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type Expect<Value extends true> = Value;
type IsOptional<ObjectType, Key extends keyof ObjectType> =
  object extends Pick<ObjectType, Key> ? true : false;

type RequiredInputIsString = Expect<
  Equal<StudentCreateRequest["studentName"], string>
>;
type RequiredInputStaysRequired = Expect<
  Equal<IsOptional<StudentCreateRequest, "studentName">, false>
>;
type OptionalInputStaysOptional = Expect<
  Equal<IsOptional<StudentCreateRequest, "alternateName">, true>
>;
type NullableIsNotMerelyAbsent = Expect<
  Equal<AcademySessionPatchRequest["description"], string | null | undefined>
>;
type ResponseUnionIsLiteral = Expect<
  Equal<StudentResponse["status"], "active" | "stop" | "temporaryStop">
>;

export interface GeneratedDtoContractAssertions {
  readonly requiredInputIsString: RequiredInputIsString;
  readonly requiredInputStaysRequired: RequiredInputStaysRequired;
  readonly optionalInputStaysOptional: OptionalInputStaysOptional;
  readonly nullableIsNotMerelyAbsent: NullableIsNotMerelyAbsent;
  readonly responseUnionIsLiteral: ResponseUnionIsLiteral;
}
