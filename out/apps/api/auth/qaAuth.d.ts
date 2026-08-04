export interface QaTokenClaims {
    appid?: string;
    azp?: string;
    aud?: string;
    tid?: string;
    iss?: string;
}
export declare function validateQaToken(bearerToken: string): Promise<QaTokenClaims>;
