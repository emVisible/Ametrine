# RAG 基准查询集

共 355 条：唯一 275、多标签 24、不可回答 40、手写 16。

每条的「金标签」是**必须被召回**的文档；`不可回答` 那批期望的是**不该被硬答**。
想手动在界面上测：打开知识库的命中测试面板，把 query 原样粘进去即可。

- **q0001** [unique/protocol/en] In which context is proxy-authentication-info mentioned, and what is stated about it?
  金标签: rfc9110
- **q0002** [unique/protocol/en] In which context is if-unmodified-since mentioned, and what is stated about it?
  金标签: rfc9110
- **q0003** [unique/protocol/en] Explain the role of content-negotiated in this document.
  金标签: rfc9110
- **q0004** [unique/protocol/en] Explain the role of content-transfer-encoding in this document.
  金标签: rfc9112
- **q0005** [unique/protocol/en] What does the document say about message-forwarding?
  金标签: rfc9112
- **q0006** [unique/protocol/en] Explain the role of case-insensitively in this document.
  金标签: rfc9112
- **q0007** [unique/protocol/en] In which context is mandatory-to-implement mentioned, and what is stated about it?
  金标签: rfc8446
- **q0008** [unique/protocol/en] Explain the role of alacritymanagement.com in this document.
  金标签: rfc8446
- **q0009** [unique/protocol/en] Explain the role of legacy_record_version in this document.
  金标签: rfc8446
- **q0010** [unique/protocol/en] Explain the role of unsupported_response_type in this document.
  金标签: rfc6749
- **q0011** [unique/protocol/en] Explain the role of w3c.rec-html401-19991224 in this document.
  金标签: rfc6749
- **q0012** [unique/protocol/en] Explain the role of temporarily_unavailable in this document.
  金标签: rfc6749
- **q0013** [unique/protocol/en] In which context is terminal-to-terminal mentioned, and what is stated about it?
  金标签: rfc854
- **q0014** [unique/protocol/en] What does the document say about process-to-process?
  金标签: rfc854
- **q0015** [unique/protocol/en] What does the document say about multiple-backspace?
  金标签: rfc854
- **q0016** [unique/protocol/en] Explain the role of point-to-point in this document.
  金标签: rfc1149
- **q0017** [unique/protocol/en] Explain the role of line-of-sight in this document.
  金标签: rfc1149
- **q0018** [unique/protocol/en] In which context is ieee802.3 mentioned, and what is stated about it?
  金标签: rfc1149
- **q0019** [unique/protocol/en] In which context is currently-assigned mentioned, and what is stated about it?
  金标签: rfc3514
- **q0020** [unique/protocol/en] Explain the role of addison-wesley in this document.
  金标签: rfc3514
- **q0021** [unique/protocol/en] In which context is email-carried mentioned, and what is stated about it?
  金标签: rfc3514
- **q0022** [unique/web-docs/zh] 关于「domaina.example」，文档里是怎么说明的？
  金标签: mdn-http-zh
- **q0023** [unique/web-docs/zh] 关于「domainb.foo」，文档里是怎么说明的？
  金标签: mdn-http-zh
- **q0024** [unique/web-docs/zh] 客户端打开一个连接以 指的是什么？有什么使用上的注意点？
  金标签: mdn-http-zh
- **q0025** [unique/web-docs/zh] 关于「access-control-allow-orig」，文档里是怎么说明的？
  金标签: mdn-cors-zh
- **q0026** [unique/web-docs/zh] 关于「xhr.upload.addeventlisten」，文档里是怎么说明的？
  金标签: mdn-cors-zh
- **q0027** [unique/web-docs/zh] 请解释 access-control-request-me 在文中的作用。
  金标签: mdn-cors-zh
- **q0028** [unique/web-docs/zh] 请解释 sha256-ex2o7mwozfczthhkm6 在文中的作用。
  金标签: mdn-csp-zh
- **q0029** [unique/web-docs/zh] sha256-geh1+8u9s1vkeuqsmm 指的是什么？有什么使用上的注意点？
  金标签: mdn-csp-zh
- **q0030** [unique/web-docs/zh] 关于「document.head.appendchild」，文档里是怎么说明的？
  金标签: mdn-csp-zh
- **q0031** [unique/web-docs/zh] bundle.ysaiaaaa-qg4g6kcma 指的是什么？有什么使用上的注意点？
  金标签: mdn-cache-zh
- **q0032** [unique/web-docs/zh] 请解释 ysaiaaaa-qg4g6kcmambaaaaa 在文中的作用。
  金标签: mdn-cache-zh
- **q0033** [unique/web-docs/zh] surrogate-control 指的是什么？有什么使用上的注意点？
  金标签: mdn-cache-zh
- **q0034** [unique/web-docs/zh] 关于「以及如何设置和操作内」，文档里是怎么说明的？
  金标签: mdn-css-layout-zh
- **q0035** [unique/web-docs/zh] 现在是时候看看如何把 指的是什么？有什么使用上的注意点？
  金标签: mdn-css-layout-zh
- **q0036** [unique/web-docs/zh] 关于「你的盒子放在与视口相」，文档里是怎么说明的？
  金标签: mdn-css-layout-zh
- **q0037** [unique/web-docs/zh] 关于「native-keyboard-accessibi」，文档里是怎么说明的？
  金标签: mdn-a11y-zh
- **q0038** [unique/web-docs/zh] 关于「document.activeelement.on」，文档里是怎么说明的？
  金标签: mdn-a11y-zh
- **q0039** [unique/web-docs/zh] 请解释 fake-div-buttons.html 在文中的作用。
  金标签: mdn-a11y-zh
- **q0040** [unique/web-docs/zh] someelement.addeventliste 指的是什么？有什么使用上的注意点？
  金标签: mdn-js-memory-zh
- **q0041** [unique/web-docs/zh] someelement.style.backgro 指的是什么？有什么使用上的注意点？
  金标签: mdn-js-memory-zh
- **q0042** [unique/web-docs/zh] 请解释 max-old-space-size 在文中的作用。
  金标签: mdn-js-memory-zh
- **q0043** [unique/web-docs/en] Explain the role of oes_draw_buffers_indexed in this document.
  金标签: mdn-webapi-zh
- **q0044** [unique/web-docs/en] What does the document say about angle_instanced_arrays?
  金标签: mdn-webapi-zh
- **q0045** [unique/web-docs/en] What does the document say about picture-in-picture?
  金标签: mdn-webapi-zh
- **q0046** [unique/programming/zh] 请解释 unregister_dialect 在文中的作用。
  金标签: py-csv-zh
- **q0047** [unique/programming/zh] 请解释 csvwriter.writerow 在文中的作用。
  金标签: py-csv-zh
- **q0048** [unique/programming/zh] 请解释 locale.getencoding 在文中的作用。
  金标签: py-csv-zh
- **q0049** [unique/programming/zh] 请解释 sqlite3.legacy_transactio 在文中的作用。
  金标签: py-sqlite-zh
- **q0050** [unique/programming/zh] 关于「connection.isolation_leve」，文档里是怎么说明的？
  金标签: py-sqlite-zh
- **q0051** [unique/programming/zh] legacy_transaction_contro 指的是什么？有什么使用上的注意点？
  金标签: py-sqlite-zh
- **q0052** [unique/programming/zh] concurrent.futures.future 指的是什么？有什么使用上的注意点？
  金标签: py-concurrent-zh
- **q0053** [unique/programming/zh] 请解释 nonexistent-subdomain.pyt 在文中的作用。
  金标签: py-concurrent-zh
- **q0054** [unique/programming/zh] set_running_or_notify_can 指的是什么？有什么使用上的注意点？
  金标签: py-concurrent-zh
- **q0055** [unique/programming/zh] 请解释 move_first_element_to_las 在文中的作用。
  金标签: py-typing-zh
- **q0056** [unique/programming/zh] collections.abc.bytestrin 指的是什么？有什么使用上的注意点？
  金标签: py-typing-zh
- **q0057** [unique/programming/zh] 关于「collections.abc.collectio」，文档里是怎么说明的？
  金标签: py-typing-zh
- **q0058** [unique/programming/zh] 请解释 string.template.substitut 在文中的作用。
  金标签: py-logging-zh
- **q0059** [unique/programming/zh] 关于「formatter_simpleformatter」，文档里是怎么说明的？
  金标签: py-logging-zh
- **q0060** [unique/programming/zh] 关于「mypackage.mymodule.myhand」，文档里是怎么说明的？
  金标签: py-logging-zh
- **q0061** [unique/cloud-native/zh] iptables-localhost-nodepo 指的是什么？有什么使用上的注意点？
  金标签: k8s-svc-zh
- **q0062** [unique/cloud-native/zh] 关于「spec.allocateloadbalancer」，文档里是怎么说明的？
  金标签: k8s-svc-zh
- **q0063** [unique/cloud-native/zh] status.loadbalancer.ingre 指的是什么？有什么使用上的注意点？
  金标签: k8s-svc-zh
- **q0064** [unique/cloud-native/zh] 请解释 用于管理容器化的工作 在文中的作用。
  金标签: k8s-overview-zh
- **q0065** [unique/cloud-native/zh] 请解释 方便进行声明式配置和 在文中的作用。
  金标签: k8s-overview-zh
- **q0066** [unique/cloud-native/zh] 请解释 拥有一个庞大且快速增 在文中的作用。
  金标签: k8s-overview-zh
- **q0067** [unique/cloud-native/zh] 请解释 cpu-initialization-period 在文中的作用。
  金标签: k8s-hpa-zh
- **q0068** [unique/cloud-native/zh] horizontal-pod-autoscale 指的是什么？有什么使用上的注意点？
  金标签: k8s-hpa-zh
- **q0069** [unique/cloud-native/zh] external.metrics.k8s.io 指的是什么？有什么使用上的注意点？
  金标签: k8s-hpa-zh
- **q0070** [unique/cloud-native/zh] 请解释 volume.beta.kubernetes.io 在文中的作用。
  金标签: k8s-pv-zh
- **q0071** [unique/cloud-native/zh] 关于「external-provisioner.volu」，文档里是怎么说明的？
  金标签: k8s-pv-zh
- **q0072** [unique/cloud-native/zh] 请解释 status.allocatedresources 在文中的作用。
  金标签: k8s-pv-zh
- **q0073** [unique/cloud-native/zh] rbac.authorization.k8s.io 指的是什么？有什么使用上的注意点？
  金标签: k8s-rbac-zh
- **q0074** [unique/cloud-native/zh] 请解释 rbac.authorization.kubern 在文中的作用。
  金标签: k8s-rbac-zh
- **q0075** [unique/cloud-native/zh] 关于「persistent-volume-provisi」，文档里是怎么说明的？
  金标签: k8s-rbac-zh
- **q0076** [unique/cloud-native/zh] 本文档概述了一个正常 指的是什么？有什么使用上的注意点？
  金标签: k8s-cni-zh
- **q0077** [unique/cloud-native/zh] 请解释 集群由控制平面和一个 在文中的作用。
  金标签: k8s-cni-zh
- **q0078** [unique/cloud-native/zh] 以下是主要组件的简要 指的是什么？有什么使用上的注意点？
  金标签: k8s-cni-zh
- **q0079** [unique/cloud-native/zh] user-interface.properties 指的是什么？有什么使用上的注意点？
  金标签: k8s-config-zh
- **q0080** [unique/cloud-native/zh] 关于「valuefrom.configmapkeyref」，文档里是怎么说明的？
  金标签: k8s-config-zh
- **q0081** [unique/cloud-native/zh] 关于「liveness-readiness-startu」，文档里是怎么说明的？
  金标签: k8s-config-zh
- **q0082** [unique/cloud-native/zh] 关于「tcp-liveness-readiness.ya」，文档里是怎么说明的？
  金标签: k8s-liveness-zh
- **q0083** [unique/cloud-native/zh] configure-liveness-readin 指的是什么？有什么使用上的注意点？
  金标签: k8s-liveness-zh
- **q0084** [unique/cloud-native/zh] 请解释 grpc-tls-liveness.yaml 在文中的作用。
  金标签: k8s-liveness-zh
- **q0085** [unique/cloud-native/en] In which context is topology-aware mentioned, and what is stated about it?
  金标签: k8s-sched-en
- **q0086** [unique/cloud-native/en] In which context is workload-aware mentioned, and what is stated about it?
  金标签: k8s-sched-en
- **q0087** [unique/cloud-native/en] In which context is node-pressure mentioned, and what is stated about it?
  金标签: k8s-sched-en
- **q0088** [unique/cloud-native/en] In which context is multi-dimensional mentioned, and what is stated about it?
  金标签: k8s-netpol-en
- **q0089** [unique/cloud-native/en] In which context is nvidia-tesla-p100 mentioned, and what is stated about it?
  金标签: k8s-netpol-en
- **q0090** [unique/cloud-native/en] In which context is inequality-based mentioned, and what is stated about it?
  金标签: k8s-netpol-en
- **q0091** [unique/web-docs/zh] 请解释 the-websocket-interface 在文中的作用。
  金标签: mdn-ws-zh
- **q0092** [unique/web-docs/zh] 关于「jsonrpc-bidirectional」，文档里是怎么说明的？
  金标签: mdn-ws-zh
- **q0093** [unique/web-docs/zh] 请解释 api.websocketstream 在文中的作用。
  金标签: mdn-ws-zh
- **q0094** [unique/web-docs/zh] promise.prototype.constru 指的是什么？有什么使用上的注意点？
  金标签: mdn-promise-zh
- **q0095** [unique/web-docs/zh] object.prototype.tostring 指的是什么？有什么使用上的注意点？
  金标签: mdn-promise-zh
- **q0096** [unique/web-docs/zh] 请解释 promise.prototype.finally 在文中的作用。
  金标签: mdn-promise-zh
- **q0097** [unique/web-docs/zh] 请解释 navigator.cookieenabled 在文中的作用。
  金标签: mdn-cookies-zh
- **q0098** [unique/web-docs/zh] 关于「window.sessionstorage」，文档里是怎么说明的？
  金标签: mdn-cookies-zh
- **q0099** [unique/web-docs/zh] 关于「window.localstorage」，文档里是怎么说明的？
  金标签: mdn-cookies-zh
- **q0100** [unique/web-docs/zh] auth_basic_user_file 指的是什么？有什么使用上的注意点？
  金标签: mdn-perm-zh
- **q0101** [unique/web-docs/zh] 关于「aws4-hmac-sha256」，文档里是怎么说明的？
  金标签: mdn-perm-zh
- **q0102** [unique/web-docs/zh] iso-8859-1 指的是什么？有什么使用上的注意点？
  金标签: mdn-perm-zh
- **q0103** [unique/public-health/zh] steliarova-foucher 指的是什么？有什么使用上的注意点？
  金标签: who-cancer-zh
- **q0104** [unique/public-health/zh] gco.iarc.fr 指的是什么？有什么使用上的注意点？
  金标签: who-cancer-zh
- **q0105** [unique/public-health/zh] 请解释 癌症是全世界的一个主 在文中的作用。
  金标签: who-cancer-zh
- **q0106** [unique/public-health/zh] 关于「饮食在塑造个人和人群」，文档里是怎么说明的？
  金标签: who-nutrition-zh
- **q0107** [unique/public-health/zh] 关于「健康和福祉方面发挥着」，文档里是怎么说明的？
  金标签: who-nutrition-zh
- **q0108** [unique/public-health/zh] 不健康饮食是疾病和残 指的是什么？有什么使用上的注意点？
  金标签: who-nutrition-zh
- **q0109** [unique/programming/en] What does the document say about once.doorwaituntildone?
  金标签: go-effective
- **q0110** [unique/programming/en] Explain the role of string-converter in this document.
  金标签: go-effective
- **q0111** [unique/programming/en] In which context is encoding_base64 mentioned, and what is stated about it?
  金标签: go-effective
- **q0112** [unique/protocol/en] In which context is internet_assigned_numbers mentioned, and what is stated about it?
  金标签: iana-protos
- **q0113** [unique/protocol/en] What does the document say about pescadero.stanford.edu?
  金标签: iana-protos
- **q0114** [unique/protocol/en] What does the document say about gandalf.engr.sgi.com?
  金标签: iana-protos
- **q0115** [unique/protocol/en] Explain the role of rfc-ietf-emailcore-rfc532 in this document.
  金标签: iana-ports
- **q0116** [unique/protocol/en] What does the document say about edn-unix.dca.mil?
  金标签: iana-ports
- **q0117** [unique/protocol/en] Explain the role of randall_stewart in this document.
  金标签: iana-ports
- **q0118** [unique/databases/en] What does the document say about noughts-and-crosses?
  金标签: pg-insert
- **q0119** [unique/databases/en] Explain the role of sequence-generated in this document.
  金标签: pg-insert
- **q0120** [unique/databases/en] What does the document say about output_expression?
  金标签: pg-insert
- **q0121** [unique/databases/en] In which context is idle_in_transaction_sessi mentioned, and what is stated about it?
  金标签: pg-transactions
- **q0122** [unique/databases/en] In which context is max_pred_locks_per_transa mentioned, and what is stated about it?
  金标签: pg-transactions
- **q0123** [unique/databases/en] In which context is max_pred_locks_per_relati mentioned, and what is stated about it?
  金标签: pg-transactions
- **q0124** [unique/databases/en] Explain the role of originally-mentioned in this document.
  金标签: pg-planner
- **q0125** [unique/databases/en] In which context is platform-dependent mentioned, and what is stated about it?
  金标签: pg-planner
- **q0126** [unique/databases/en] What does the document say about cpu_operator_cost?
  金标签: pg-planner
- **q0127** [unique/databases/en] In which context is server-version-specific mentioned, and what is stated about it?
  金标签: pg-backup
- **q0128** [unique/databases/en] In which context is single-transaction mentioned, and what is stated about it?
  金标签: pg-backup
- **q0129** [unique/databases/en] Explain the role of on_error_stop in this document.
  金标签: pg-backup
- **q0130** [unique/public-health/zh] 请解释 结核病是单一传染病原 在文中的作用。
  金标签: who-tb-zh
- **q0131** [unique/public-health/zh] 请解释 体导致的全球主要死因 在文中的作用。
  金标签: who-tb-zh
- **q0132** [unique/public-health/zh] 请解释 结核病还是艾滋病毒感 在文中的作用。
  金标签: who-tb-zh
- **q0133** [unique/public-health/zh] 请解释 世卫组织非洲区域在全 在文中的作用。
  金标签: who-malaria-zh
- **q0134** [unique/public-health/zh] 关于「球疟疾负担中所占比例」，文档里是怎么说明的？
  金标签: who-malaria-zh
- **q0135** [unique/public-health/zh] 请解释 世卫组织非洲区域占疟 在文中的作用。
  金标签: who-malaria-zh
- **q0136** [unique/public-health/zh] 请解释 results.institute 在文中的作用。
  金标签: who-diabetes-zh
- **q0137** [unique/public-health/zh] evaluation.2024 指的是什么？有什么使用上的注意点？
  金标签: who-diabetes-zh
- **q0138** [unique/public-health/zh] 请解释 network.global 在文中的作用。
  金标签: who-diabetes-zh
- **q0139** [unique/public-health/zh] aguilar-gaxiola 指的是什么？有什么使用上的注意点？
  金标签: who-depression-zh
- **q0140** [unique/public-health/zh] evans-lacko 指的是什么？有什么使用上的注意点？
  金标签: who-depression-zh
- **q0141** [unique/public-health/zh] 关于「al-hamzawi」，文档里是怎么说明的？
  金标签: who-depression-zh
- **q0142** [unique/public-health/zh] 请解释 艾滋病毒仍然是一个重 在文中的作用。
  金标签: who-hivaids-zh
- **q0143** [unique/public-health/zh] 关于「大的全球公共卫生问题」，文档里是怎么说明的？
  金标签: who-hivaids-zh
- **q0144** [unique/public-health/zh] 该病毒目前在全球所有 指的是什么？有什么使用上的注意点？
  金标签: who-hivaids-zh
- **q0145** [unique/programming/en] What does the document say about sys.flags.thread_inherit?
  金标签: py-gil-en
- **q0146** [unique/programming/en] In which context is setprofile_all_threads mentioned, and what is stated about it?
  金标签: py-gil-en
- **q0147** [unique/programming/en] Explain the role of performance-oriented in this document.
  金标签: py-gil-en
- **q0148** [unique/programming/en] Explain the role of fstring_replacement_field in this document.
  金标签: py-isort-en
- **q0149** [unique/programming/en] What does the document say about fstring_full_format_spec?
  金标签: py-isort-en
- **q0150** [unique/programming/en] In which context is conditional_expression mentioned, and what is stated about it?
  金标签: py-isort-en
- **q0151** [unique/cloud-native/en] Explain the role of application-centric in this document.
  金标签: k8s-drain-en
- **q0152** [unique/cloud-native/en] Explain the role of application-level in this document.
  金标签: k8s-drain-en
- **q0153** [unique/cloud-native/en] Explain the role of data-processing in this document.
  金标签: k8s-drain-en
- **q0154** [unique/web-standards/en] What does the document say about aria-describedby?
  金标签: w3c-wcag-en
- **q0155** [unique/web-standards/en] In which context is look-alikes mentioned, and what is stated about it?
  金标签: w3c-wcag-en
- **q0156** [unique/web-standards/en] What does the document say about time-based?
  金标签: w3c-wcag-en
- **q0157** [unique/web-standards/en] What does the document say about multi-thumb?
  金标签: w3c-aria-apg-en
- **q0158** [unique/web-standards/en] What does the document say about dual-state?
  金标签: w3c-aria-apg-en
- **q0159** [unique/web-standards/en] In which context is tri-state mentioned, and what is stated about it?
  金标签: w3c-aria-apg-en
- **q0160** [unique/web-standards/en] Explain the role of rec-wai-aria-1.1-20171214 in this document.
  金标签: w3c-aria-en
- **q0161** [unique/web-standards/en] Explain the role of pr-wai-aria-1.1-20171102 in this document.
  金标签: w3c-aria-en
- **q0162** [unique/web-standards/en] Explain the role of wai-aria-practices-1.1 in this document.
  金标签: w3c-aria-en
- **q0163** [unique/security/en] What does the document say about subscriber-provided?
  金标签: nist-63b-en
- **q0164** [unique/security/en] In which context is nist.sp.800-131ar1 mentioned, and what is stated about it?
  金标签: nist-63b-en
- **q0165** [unique/security/en] In which context is randomly-generated mentioned, and what is stated about it?
  金标签: nist-63b-en
- **q0166** [unique/security/en] Explain the role of identity-proofing-and-ver in this document.
  金标签: nist-63a-en
- **q0167** [unique/security/en] What does the document say about ification-of-an-individua?
  金标签: nist-63a-en
- **q0168** [unique/security/en] In which context is and-address-discrepancies mentioned, and what is stated about it?
  金标签: nist-63a-en
- **q0169** [unique/security/en] Explain the role of openid-connect-core-1_0.h in this document.
  金标签: nist-63c-en
- **q0170** [unique/security/en] What does the document say about sstc-saml-tech-overview-2?
  金标签: nist-63c-en
- **q0171** [unique/security/en] In which context is separately-administered mentioned, and what is stated about it?
  金标签: nist-63c-en
- **q0172** [unique/web-docs/en] Explain the role of workerglobalscope.fetch in this document.
  金标签: mdn-fetch-en
- **q0173** [unique/web-docs/en] What does the document say about deferred-fetch-minimal?
  金标签: mdn-fetch-en
- **q0174** [unique/web-docs/en] In which context is api.window.fetchlater mentioned, and what is stated about it?
  金标签: mdn-fetch-en
- **q0175** [unique/web-docs/en] What does the document say about serviceworkercontainer.re?
  金标签: mdn-serviceworker-en
- **q0176** [unique/web-docs/en] What does the document say about workernavigator.servicewo?
  金标签: mdn-serviceworker-en
- **q0177** [unique/web-docs/en] In which context is workerglobalscope.caches mentioned, and what is stated about it?
  金标签: mdn-serviceworker-en
- **q0178** [unique/literature/en] What does the document say about self-reproaches?
  金标签: gutenberg-frankenstein
- **q0179** [unique/literature/en] What does the document say about ten-thousandth?
  金标签: gutenberg-frankenstein
- **q0180** [unique/literature/en] In which context is whale-fishers mentioned, and what is stated about it?
  金标签: gutenberg-frankenstein
- **q0181** [unique/literature/en] Explain the role of three-and-twenty in this document.
  金标签: gutenberg-pride
- **q0182** [unique/literature/en] What does the document say about over-scrupulous?
  金标签: gutenberg-pride
- **q0183** [unique/literature/en] Explain the role of good-humoured in this document.
  金标签: gutenberg-pride
- **q0184** [unique/literature/en] What does the document say about sub-sub-librarian?
  金标签: gutenberg-mobydick
- **q0185** [unique/literature/en] What does the document say about battering-ram?
  金标签: gutenberg-mobydick
- **q0186** [unique/literature/en] What does the document say about quarter-deck?
  金标签: gutenberg-mobydick
- **q0187** [unique/literature/en] Explain the role of vitriol-throwing in this document.
  金标签: gutenberg-holmes
- **q0188** [unique/literature/en] What does the document say about well-remembered?
  金标签: gutenberg-holmes
- **q0189** [unique/literature/en] Explain the role of upper-attendant in this document.
  金标签: gutenberg-holmes
- **q0190** [unique/literature/en] In which context is seventy-four mentioned, and what is stated about it?
  金标签: gutenberg-tomsoyer
- **q0191** [unique/literature/en] What does the document say about going-over?
  金标签: gutenberg-tomsoyer
- **q0192** [unique/literature/en] In which context is deep-laid mentioned, and what is stated about it?
  金标签: gutenberg-tomsoyer
- **q0193** [unique/literature/en] In which context is five-and-twentieth mentioned, and what is stated about it?
  金标签: gutenberg-tale2cities
- **q0194** [unique/literature/en] Explain the role of disfigurement--and in this document.
  金标签: gutenberg-tale2cities
- **q0195** [unique/literature/en] Explain the role of fellow-tradesman in this document.
  金标签: gutenberg-tale2cities
- **q0196** [unique/literature/en] In which context is horror-stricken mentioned, and what is stated about it?
  金标签: gutenberg-grimms
- **q0197** [unique/literature/en] What does the document say about christmas-time?
  金标签: gutenberg-grimms
- **q0198** [unique/literature/en] In which context is entrance-hall mentioned, and what is stated about it?
  金标签: gutenberg-grimms
- **q0199** [unique/biomed/en] In which context is j.foodcont.2022.109332 mentioned, and what is stated about it?
  金标签: pmc-gutmicro
- **q0200** [unique/biomed/en] Explain the role of j.foodcont.2022.108815 in this document.
  金标签: pmc-gutmicro
- **q0201** [unique/biomed/en] Explain the role of j.jfoodeng.2020.110148 in this document.
  金标签: pmc-gutmicro
- **q0202** [unique/biomed/en] Explain the role of science.185.4157.1124 in this document.
  金标签: pmc-als
- **q0203** [unique/biomed/en] Explain the role of eidos.jpc.2020.0013 in this document.
  金标签: pmc-als
- **q0204** [unique/biomed/en] Explain the role of fpsyt.2021.642322 in this document.
  金标签: pmc-als
- **q0205** [unique/biomed/en] Explain the role of circheartfailure.120.0078 in this document.
  金标签: pmc-telemed
- **q0206** [unique/biomed/en] Explain the role of concentration-dependent in this document.
  金标签: pmc-telemed
- **q0207** [unique/biomed/en] What does the document say about phosphocreatine-to-atp?
  金标签: pmc-telemed
- **q0208** [unique/research/en] What does the document say about multiple-choice?
  金标签: arxiv-2609-38155v1
- **q0209** [unique/research/en] What does the document say about text-derived?
  金标签: arxiv-2609-38155v1
- **q0210** [unique/research/en] In which context is long-video mentioned, and what is stated about it?
  金标签: arxiv-2609-38155v1
- **q0211** [unique/research/en] Explain the role of training-free in this document.
  金标签: arxiv-2609-38099v1
- **q0212** [unique/research/en] Explain the role of decoder-only in this document.
  金标签: arxiv-2609-38099v1
- **q0213** [unique/research/en] Explain the role of prompt-based in this document.
  金标签: arxiv-2609-38099v1
- **q0214** [unique/research/en] Explain the role of maximum-reasoning-effort in this document.
  金标签: arxiv-2609-38021v1
- **q0215** [unique/research/en] Explain the role of transcript-derived in this document.
  金标签: arxiv-2609-38021v1
- **q0216** [unique/research/en] Explain the role of knowledge-update in this document.
  金标签: arxiv-2609-38021v1
- **q0217** [unique/research/en] What does the document say about mixed-metal?
  金标签: arxiv-2609-38125v1
- **q0218** [unique/research/en] In which context is mixed-anion mentioned, and what is stated about it?
  金标签: arxiv-2609-38125v1
- **q0219** [unique/research/en] In which context is sn-based mentioned, and what is stated about it?
  金标签: arxiv-2609-38125v1
- **q0220** [unique/research/en] Explain the role of finite-displacement in this document.
  金标签: arxiv-2609-38071v1
- **q0221** [unique/research/en] What does the document say about reciprocal-space?
  金标签: arxiv-2609-38071v1
- **q0222** [unique/research/en] Explain the role of cond-mat.str-el in this document.
  金标签: arxiv-2609-38071v1
- **q0223** [unique/research/en] Explain the role of electric-field-dependent in this document.
  金标签: arxiv-2609-38033v1
- **q0224** [unique/research/en] What does the document say about cond-mat.mes-hall?
  金标签: arxiv-2609-38033v1
- **q0225** [unique/research/en] Explain the role of momentum-direct in this document.
  金标签: arxiv-2609-38033v1
- **q0226** [unique/research/en] What does the document say about reinforcement-learning?
  金标签: arxiv-2609-38081v1
- **q0227** [unique/research/en] Explain the role of imagenet-trained in this document.
  金标签: arxiv-2609-38081v1
- **q0228** [unique/research/en] What does the document say about mode-connected?
  金标签: arxiv-2609-38081v1
- **q0229** [unique/research/en] In which context is pattern-completion mentioned, and what is stated about it?
  金标签: arxiv-2609-37991v1
- **q0230** [unique/research/en] What does the document say about abstract-pattern?
  金标签: arxiv-2609-37991v1
- **q0231** [unique/research/en] In which context is attention-head mentioned, and what is stated about it?
  金标签: arxiv-2609-37991v1
- **q0232** [unique/research/en] In which context is inter-individual mentioned, and what is stated about it?
  金标签: arxiv-2609-37642v1
- **q0233** [unique/research/en] In which context is self-supervised mentioned, and what is stated about it?
  金标签: arxiv-2609-37642v1
- **q0234** [unique/research/en] What does the document say about criterion-function?
  金标签: arxiv-2609-37412v1
- **q0235** [unique/research/en] In which context is neyman-orthogonal mentioned, and what is stated about it?
  金标签: arxiv-2609-37412v1
- **q0236** [unique/research/en] Explain the role of interval-censored in this document.
  金标签: arxiv-2609-37412v1
- **q0237** [unique/research/en] In which context is mixed-frequency mentioned, and what is stated about it?
  金标签: arxiv-2609-37168v1
- **q0238** [unique/research/en] What does the document say about macro-financial?
  金标签: arxiv-2609-37168v1
- **q0239** [unique/research/en] Explain the role of high-frequency in this document.
  金标签: arxiv-2609-37168v1
- **q0240** [unique/research/en] What does the document say about covariate-dependent?
  金标签: arxiv-2609-36824v1
- **q0241** [unique/research/en] Explain the role of data-generating in this document.
  金标签: arxiv-2609-36824v1
- **q0242** [unique/research/en] In which context is size-adjusted mentioned, and what is stated about it?
  金标签: arxiv-2609-36824v1
- **q0243** [unique/research/en] In which context is self-regulated mentioned, and what is stated about it?
  金标签: arxiv-2609-36176v1
- **q0244** [unique/research/en] Explain the role of tablet-supported in this document.
  金标签: arxiv-2609-36175v1
- **q0245** [unique/research/en] In which context is tablet-based mentioned, and what is stated about it?
  金标签: arxiv-2609-36175v1
- **q0246** [unique/research/en] What does the document say about step-by-step?
  金标签: arxiv-2609-36175v1
- **q0247** [unique/research/en] Explain the role of zenodo.20302944 in this document.
  金标签: arxiv-2609-35334v1
- **q0248** [unique/research/en] In which context is pseudo-synchronous mentioned, and what is stated about it?
  金标签: arxiv-2609-38128v1
- **q0249** [unique/research/en] Explain the role of gravity-darkened in this document.
  金标签: arxiv-2609-38128v1
- **q0250** [unique/research/en] In which context is time-dependent mentioned, and what is stated about it?
  金标签: arxiv-2609-38128v1
- **q0251** [unique/research/en] What does the document say about concentration-delta-value?
  金标签: arxiv-2609-38063v1
- **q0252** [unique/research/en] What does the document say about optimization---demonstrat?
  金标签: arxiv-2609-36381v1
- **q0253** [unique/research/en] Explain the role of experiments---including in this document.
  金标签: arxiv-2609-36381v1
- **q0254** [unique/research/en] What does the document say about convection-permitting?
  金标签: arxiv-2609-36381v1
- **q0255** [unique/research/en] What does the document say about outcome-weighted?
  金标签: arxiv-2609-38175v1
- **q0256** [unique/research/en] In which context is cross-proxy mentioned, and what is stated about it?
  金标签: arxiv-2609-38175v1
- **q0257** [unique/research/en] What does the document say about stress-test?
  金标签: arxiv-2609-38175v1
- **q0258** [unique/research/en] Explain the role of goodness-of-fit in this document.
  金标签: arxiv-2609-38158v1
- **q0259** [unique/research/en] In which context is bahadur-type mentioned, and what is stated about it?
  金标签: arxiv-2609-38158v1
- **q0260** [unique/research/en] In which context is a-portugu mentioned, and what is stated about it?
  金标签: arxiv-2609-38158v1
- **q0261** [unique/research/en] Explain the role of low-dimensional in this document.
  金标签: arxiv-2609-38141v1
- **q0262** [unique/research/en] Explain the role of tree-structured in this document.
  金标签: arxiv-2609-38141v1
- **q0263** [unique/research/en] What does the document say about multi-source?
  金标签: arxiv-2609-38141v1
- **q0264** [unique/noisy/en] In which context is resource-specific mentioned, and what is stated about it?
  金标签: noise-table-only-rfc9110
- **q0265** [unique/noisy/en] Explain the role of client-initiated in this document.
  金标签: noise-table-only-rfc9110
- **q0266** [unique/noisy/en] Explain the role of content-encoded in this document.
  金标签: noise-table-only-rfc9110
- **q0267** [unique/noisy/en] What does the document say about rfc854.txt?
  金标签: noise-table-only-rfc854
- **q0268** [unique/noisy/en] What does the document say about rfc9112.txt?
  金标签: noise-truncated-300-rfc9112
- **q0269** [unique/noisy/en] Explain the role of rfc1149.txt in this document.
  金标签: noise-truncated-300-rfc1149
- **q0270** [unique/noisy/en] What does the document say about rfc8446.txt?
  金标签: noise-ocr-confusion-rfc8446
- **q0271** [unique/noisy/en] Explain the role of currently-assign in this document.
  金标签: noise-ocr-confusion-rfc3514
- **q0272** [unique/noisy/en] In which context is rfc3514.txt mentioned, and what is stated about it?
  金标签: noise-ocr-confusion-rfc3514
- **q0273** [unique/noisy/en] Explain the role of multi-ievel in this document.
  金标签: noise-ocr-confusion-rfc3514
- **q0274** [unique/noisy/en] In which context is rfc6749.txt mentioned, and what is stated about it?
  金标签: noise-boilerplate-shell-rfc6749
- **q0275** [unique/noisy/en] Explain the role of web-docs in this document.
  金标签: noise-boilerplate-shell-mdn-http-zh
- **q0276** [multi/cross/en] Which documents mention app.kubernetes.io? List all of them.
  金标签: k8s-svc-zh, k8s-netpol-en
- **q0277** [multi/cross/en] Which documents mention math.ho? List all of them.
  金标签: arxiv-2609-36176v1, arxiv-2609-36175v1, arxiv-2609-35334v1
- **q0278** [multi/cross/en] Which documents mention bbn.com? List all of them.
  金标签: rfc1149, iana-protos, iana-ports
- **q0279** [multi/cross/en] Which documents mention q-bio.nc? List all of them.
  金标签: arxiv-2609-38081v1, arxiv-2609-37991v1, arxiv-2609-37642v1
- **q0280** [multi/cross/en] Which documents mention nist.sp.800-63c? List all of them.
  金标签: nist-63b-en, nist-63a-en, nist-63c-en
- **q0281** [multi/cross/en] Which documents mention acm.org? List all of them.
  金标签: rfc8446, rfc3514
- **q0282** [multi/cross/en] Which documents mention cond-mat? List all of them.
  金标签: arxiv-2609-38125v1, arxiv-2609-38071v1, arxiv-2609-38033v1
- **q0283** [multi/cross/en] Which documents mention us.ibm.com? List all of them.
  金标签: rfc8446, w3c-aria-en
- **q0284** [multi/cross/en] Which documents mention to-morrow? List all of them.
  金标签: gutenberg-pride, gutenberg-tale2cities
- **q0285** [multi/cross/en] Which documents mention watson.ibm.com? List all of them.
  金标签: rfc8446, iana-protos
- **q0286** [multi/cross/en] Which documents mention creativecommons.org? List all of them.
  金标签: pmc-gutmicro, pmc-als, pmc-telemed
- **q0287** [multi/cross/en] Which documents mention content-encoding? List all of them.
  金标签: rfc9110, rfc9112, mdn-cors-zh, noise-table-only-rfc9110
- **q0288** [multi/cross/en] Which documents mention nvlpubs.nist.gov? List all of them.
  金标签: nist-63a-en, nist-63c-en
- **q0289** [multi/cross/en] Which documents mention content-length? List all of them.
  金标签: rfc9110, rfc9112, mdn-cors-zh, mdn-cache-zh
- **q0290** [multi/cross/en] Which documents mention physics.ao-ph? List all of them.
  金标签: arxiv-2609-38128v1, arxiv-2609-38063v1, arxiv-2609-36381v1
- **q0291** [multi/cross/en] Which documents mention transfer-encoding? List all of them.
  金标签: rfc9112, mdn-cors-zh
- **q0292** [multi/cross/en] Which documents mention cache-control? List all of them.
  金标签: mdn-cors-zh, mdn-cache-zh
- **q0293** [multi/cross/en] Which documents mention three-dimensional? List all of them.
  金标签: pmc-gutmicro, pmc-telemed, arxiv-2609-36381v1
- **q0294** [multi/cross/en] Which documents mention gradient-based? List all of them.
  金标签: arxiv-2609-38081v1, arxiv-2609-36381v1
- **q0295** [multi/cross/zh] 哪些文档提到了 超文本传输协议？请都列出来。
  金标签: mdn-http-zh, mdn-cache-zh, noise-boilerplate-shell-mdn-http-zh
- **q0296** [multi/cross/en] Which documents mention quoted-string? List all of them.
  金标签: rfc9110, rfc9112
- **q0297** [multi/cross/en] Which documents mention cpu_tuple_cost? List all of them.
  金标签: pg-transactions, pg-planner
- **q0298** [multi/cross/en] Which documents mention kube-controller-manager? List all of them.
  金标签: k8s-hpa-zh, k8s-rbac-zh, k8s-cni-zh, k8s-netpol-en
- **q0299** [multi/cross/en] Which documents mention max-age? List all of them.
  金标签: mdn-cors-zh, mdn-cache-zh, mdn-cookies-zh
- **q0300** [unanswerable/negative/en] What do the documents say about app.kubernetes.vv685?
  金标签: （无，应当拒答）
- **q0301** [unanswerable/negative/en] What do the documents say about math.qa187?
  金标签: （无，应当拒答）
- **q0302** [unanswerable/negative/en] What do the documents say about bbn.cvv271?
  金标签: （无，应当拒答）
- **q0303** [unanswerable/negative/en] What do the documents say about q-bio.vv925?
  金标签: （无，应当拒答）
- **q0304** [unanswerable/negative/en] What do the documents say about nist.sp.800-6qa701?
  金标签: （无，应当拒答）
- **q0305** [unanswerable/negative/en] What do the documents say about acm.ovv659?
  金标签: （无，应当拒答）
- **q0306** [unanswerable/negative/en] What do the documents say about cond-mvv858?
  金标签: （无，应当拒答）
- **q0307** [unanswerable/negative/en] What do the documents say about us.ibm.cvv796?
  金标签: （无，应当拒答）
- **q0308** [unanswerable/negative/en] What do the documents say about to-morrxz155?
  金标签: （无，应当拒答）
- **q0309** [unanswerable/negative/en] What do the documents say about watson.ibm.cqa984?
  金标签: （无，应当拒答）
- **q0310** [unanswerable/negative/en] What do the documents say about creativecommons.ovv699?
  金标签: （无，应当拒答）
- **q0311** [unanswerable/negative/en] What do the documents say about content-encodivv583?
  金标签: （无，应当拒答）
- **q0312** [unanswerable/negative/en] What do the documents say about nvlpubs.nist.gqa705?
  金标签: （无，应当拒答）
- **q0313** [unanswerable/negative/en] What do the documents say about content-lengqa200?
  金标签: （无，应当拒答）
- **q0314** [unanswerable/negative/en] What do the documents say about physics.ao-qa239?
  金标签: （无，应当拒答）
- **q0315** [unanswerable/negative/en] What do the documents say about transfer-encodivv611?
  金标签: （无，应当拒答）
- **q0316** [unanswerable/negative/en] What do the documents say about cache-contrvv612?
  金标签: （无，应当拒答）
- **q0317** [unanswerable/negative/en] What do the documents say about three-dimensionxz815?
  金标签: （无，应当拒答）
- **q0318** [unanswerable/negative/en] What do the documents say about gradient-basvv662?
  金标签: （无，应当拒答）
- **q0319** [unanswerable/negative/en] 文档里关于 超文本传输qa135 有什么说明？
  金标签: （无，应当拒答）
- **q0320** [unanswerable/negative/en] What do the documents say about quoted-strixz861?
  金标签: （无，应当拒答）
- **q0321** [unanswerable/negative/en] What do the documents say about cpu_tuple_coqa922?
  金标签: （无，应当拒答）
- **q0322** [unanswerable/negative/en] What do the documents say about kube-controller-managqa824?
  金标签: （无，应当拒答）
- **q0323** [unanswerable/negative/en] What do the documents say about max-avv571?
  金标签: （无，应当拒答）
- **q0324** [unanswerable/negative/en] What do the documents say about mozilla.ovv645?
  金标签: （无，应当拒答）
- **q0325** [unanswerable/negative/en] What do the documents say about authentication-inqa623?
  金标签: （无，应当拒答）
- **q0326** [unanswerable/negative/en] What do the documents say about randomly-chosxz359?
  金标签: （无，应当拒答）
- **q0327** [unanswerable/negative/en] What do the documents say about x-www-form-urlencodvv355?
  金标签: （无，应当拒答）
- **q0328** [unanswerable/negative/en] What do the documents say about cross-origvv172?
  金标签: （无，应当拒答）
- **q0329** [unanswerable/negative/en] What do the documents say about covid-qa222?
  金标签: （无，应当拒答）
- **q0330** [unanswerable/negative/en] What do the documents say about gmail.cxz430?
  金标签: （无，应当拒答）
- **q0331** [unanswerable/negative/en] What do the documents say about www-authenticaxz426?
  金标签: （无，应当拒答）
- **q0332** [unanswerable/negative/en] What do the documents say about e-governmevv737?
  金标签: （无，应当拒答）
- **q0333** [unanswerable/negative/en] What do the documents say about kube-proxz384?
  金标签: （无，应当拒答）
- **q0334** [unanswerable/negative/en] What do the documents say about greenbytes.qa991?
  金标签: （无，应当拒答）
- **q0335** [unanswerable/negative/en] What do the documents say about single-uvv813?
  金标签: （无，应当拒答）
- **q0336** [unanswerable/negative/en] What do the documents say about fetchevent.respondwivv949?
  金标签: （无，应当拒答）
- **q0337** [unanswerable/negative/en] What do the documents say about mnot.nqa791?
  金标签: （无，应当拒答）
- **q0338** [unanswerable/negative/en] What do the documents say about if-none-matqa790?
  金标签: （无，应当拒答）
- **q0339** [unanswerable/negative/en] What do the documents say about to-nigxz127?
  金标签: （无，应当拒答）
- **q0340** [hand/web-docs/zh] 浏览器什么时候会先发一个预检请求？
  金标签: mdn-cors-zh
- **q0341** [hand/web-docs/zh] 服务端要返回哪些响应头才允许跨域携带凭据？
  金标签: mdn-cors-zh
- **q0342** [hand/web-docs/zh] max-age=0 和 no-cache 有什么区别？
  金标签: mdn-cache-zh
- **q0343** [hand/cloud-native/zh] Kubernetes 的 Service 有哪几种类型，分别用在什么场景？
  金标签: k8s-svc-zh
- **q0344** [hand/cloud-native/zh] Role 和 ClusterRole 的差别是什么？
  金标签: k8s-rbac-zh
- **q0345** [hand/programming/zh] 用 sqlite3 模块怎么避免 SQL 注入？
  金标签: py-sqlite-zh
- **q0346** [hand/programming/zh] csv 模块里的 dialect 是干什么的？
  金标签: py-csv-zh
- **q0347** [hand/public-health/zh] 肺结核的传播途径和主要症状有哪些？
  金标签: who-tb-zh
- **q0348** [hand/public-health/zh] 糖尿病有两类吗？各自的特点是什么？
  金标签: who-diabetes-zh
- **q0349** [hand/protocol/en] Which HTTP methods are defined as safe, and why does that matter?
  金标签: rfc9110
- **q0350** [hand/protocol/en] What does a 408 status code mean according to the spec?
  金标签: rfc9110
- **q0351** [hand/protocol/en] What changed in the TLS 1.3 handshake compared with earlier versions?
  金标签: rfc8446
- **q0352** [hand/protocol/en] Describe the authorization code grant flow.
  金标签: rfc6749
- **q0353** [hand/protocol/en] What is the maximum transmission unit for datagrams carried by avian hosts?
  金标签: rfc1149
- **q0354** [hand/literature/en] Who is the narrator writing letters at the beginning of the novel?
  金标签: gutenberg-frankenstein
- **q0355** [hand/web-docs/zh] 写 HTML 时怎样让页面更容易被无障碍工具读取？
  金标签: mdn-a11y-zh
