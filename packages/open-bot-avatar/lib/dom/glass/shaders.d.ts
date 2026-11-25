export declare const vertexShader = "#version 300 es\nprecision highp float;\nconst vec2 POS[3] = vec2[](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));\nout vec2 vNdc;\nvoid main() {\n  gl_Position = vec4(POS[gl_VertexID], 0., 1.);\n  vNdc = POS[gl_VertexID];\n}";
export declare const fragmentShader: string;
