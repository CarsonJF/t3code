import totFaceScript from "@t3tools/mobile-totface-stream";
import { TOT_FACE_ACTION, type TotAvatar, type TotFaceState } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import { TotStillFace } from "./TotStillFace";

const faceMessage = (avatar: TotAvatar, state: TotFaceState, size: number) =>
  JSON.stringify({
    action: TOT_FACE_ACTION[state],
    color: avatar.color,
    skin: avatar.skin,
    shape: avatar.shape,
    antenna: avatar.antenna,
    accessories: avatar.accessories ?? [],
    size,
    motion: "auto",
  });

const faceDocument = (initial: string) => {
  const safeInitial = initial.replace(/</g, "\\u003c");
  const safeScript = totFaceScript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"></head><body><script>window.__TOT_FACE__=${safeInitial};\n${safeScript}</script></body></html>`;
};

/** A Tot's moving face: one WebView running BoopFace, or its still pose when motion is off. */
export function TotLiveFace(props: {
  readonly avatar: TotAvatar;
  readonly state: TotFaceState;
  readonly size: number;
  readonly animate: boolean;
}) {
  const webView = useRef<WebView<object>>(null);
  // The document loads once with the first face; later faces arrive by message.
  const [source] = useState(() => ({
    html: faceDocument(faceMessage(props.avatar, props.state, props.size)),
  }));
  // The WebView paints nothing until its document loads, which read as a missing face.
  const [painted, setPainted] = useState(false);
  const message = faceMessage(props.avatar, props.state, props.size);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends the new face to the WebView
  useEffect(() => {
    webView.current?.postMessage(message);
  }, [message]);

  if (!props.animate) {
    return <TotStillFace avatar={props.avatar} state={props.state} size={props.size} />;
  }
  return (
    <View style={{ width: props.size, height: props.size }} pointerEvents="none">
      {/* The still pose stands in until the WebView has something to show. */}
      {painted ? null : (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <TotStillFace avatar={props.avatar} state={props.state} size={props.size} />
        </View>
      )}
      <WebView<object>
        ref={webView}
        source={source}
        originWhitelist={["about:blank"]}
        scrollEnabled={false}
        bounces={false}
        setSupportMultipleWindows={false}
        onLoadEnd={() => setPainted(true)}
        style={{
          width: props.size,
          height: props.size,
          backgroundColor: "transparent",
          opacity: painted ? 1 : 0,
        }}
        containerStyle={{ backgroundColor: "transparent" }}
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      />
    </View>
  );
}
