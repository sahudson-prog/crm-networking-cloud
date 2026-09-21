export type GoogleConnectionRevalidationUi = {
  googleAuthorizationVerifying: boolean;
  googleConnectionLoading: boolean;
};

export function googleConnectionRevalidationUi(input: {
  hasKnownState: boolean;
  isOAuthReturn: boolean;
}): GoogleConnectionRevalidationUi {
  return {
    googleAuthorizationVerifying: input.isOAuthReturn,
    googleConnectionLoading: input.isOAuthReturn || !input.hasKnownState
  };
}
